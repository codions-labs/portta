import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import {
  ALIASES_MARKER,
  type ContainerRecord,
  type GatewayConfig,
  hostLabel,
  hostLabelFromLabels,
  hostnameFor,
  hostnameFromLabel,
  httpRouterNames,
  httpRoutes,
  isTcpOnly,
  type ProtectionStore,
  parseAliases,
  parseProtectionStore,
  readProtectionStore,
  readTraefikLabels,
  renderAliasesForStore,
  renderAuthDynamic,
  renderShares,
  SHARES_MARKER,
  type StoredAlias,
  setEnvValue,
  setProtection,
  shareLabel,
  slug,
  traefikEnabled,
  traefikServiceNames,
  writeEnvFile,
} from 'portta-core'
import { z } from 'portta-core/zod'
import { isMap, isSeq, parseDocument } from 'yaml'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { RefusedError } from '../errors.js'
import { Output } from '../output.js'
import { type RuntimePlan, renderRuntimeOverlay } from './compose-runtime.js'
import { exposurePaths, saveExposure } from './exposure.js'

const Share = z
  .object({
    id: z.string().min(1),
    project: z.string().min(1),
    service: z.string().min(1),
    host: z.string().min(1),
    entryPoint: z.string().min(1),
    container: z.string().min(1),
    port: z.number().int().positive(),
    mode: z.enum(['public', 'protected']),
  })
  .passthrough()

export interface HostnameMove {
  project: string
  service: string
  oldHost: string
  newHost: string
  kind: 'service' | 'share'
}

interface Replacement {
  path: string
  before: string | null
  after: string
}

export interface HostnameMigration {
  moves: HostnameMove[]
  files: Replacement[]
  store: ProtectionStore
  storeChanged: boolean
  profile: string
  root: string
}

function textAt(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Only the migration reads the retired naming format. It never becomes a routing fallback. */
function retiredLabel(project: string, service: string): string {
  const label = `${slug(project)}-${slug(service)}`
  if (label.length <= 63) return label
  let hash = 0x811c9dc5
  for (let i = 0; i < label.length; i++) hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0
  const digest = hash.toString(36).padStart(6, '0').slice(-6)
  return `${label.slice(0, 56).replace(/-+$/, '')}-${digest}`
}

function generatedOrigin(host: string, project: string, service: string): boolean {
  const base = domainOf(host)
  const port = portOf(host)
  return [retiredLabel(project, service), `${slug(project)}-${slug(service)}`, hostLabel({ project, service })].some(
    (label) => host === `${label}.${base}${port}`,
  )
}

function domainOf(host: string): string {
  const url = new URL(`http://${host}`)
  const separator = url.hostname.indexOf('.')
  if (separator < 0) throw new RefusedError(`cannot establish the base domain of ${host}`)
  return url.hostname.slice(separator + 1)
}

function portOf(host: string): string {
  const port = new URL(`http://${host}`).port
  return port ? `:${port}` : ''
}

/** Update only the exact retired TCP template rules, retaining unrelated project configuration. */
function migrateTcpTemplate(
  text: string,
  project: string,
): { text: string; labels: Record<string, string>; services: string[] } {
  const labels: Record<string, string> = {}
  const services: string[] = []
  if (!text.includes('traefik.tcp.')) return { text, labels, services }
  const document = parseDocument(text)
  if (document.errors.length)
    throw new RefusedError('cannot parse a TCP integration for migration', document.errors[0]?.message)
  for (const service of ['postgres', 'redis']) {
    const node = document.getIn(['services', service, 'labels'], true)
    if (!isMap(node) && !isSeq(node)) continue
    const entries: Array<{ key: string; value: string; index?: number }> = isSeq(node)
      ? node.items.flatMap((item, index) => {
          const text = String(item)
          const at = text.indexOf('=')
          return at < 0 ? [] : [{ key: text.slice(0, at), value: text.slice(at + 1), index }]
        })
      : node.items.map((item) => ({ key: String(item.key), value: String(item.value) }))
    const expected = [
      `HostSNIRegexp(\`^\${COMPOSE_PROJECT_NAME}-${service}\\..+$\`)`,
      `HostSNIRegexp(\`^${project}-${service}\\..+$\`)`,
    ]
    const rule = entries.find(
      (entry) => /^traefik\.tcp\.routers\.[^.]+\.rule$/i.test(entry.key) && expected.includes(entry.value),
    )
    if (!rule) continue
    const key = `PORTTA_${service.toUpperCase()}_HOST_LABEL`
    const canonical = hostLabel({ project, service })
    const replacement = `HostSNIRegexp(\`^\${${key}}\\..+$\`)`
    if (isSeq(node)) {
      node.set(rule.index!, `${rule.key}=${replacement}`)
      const assigned = entries.find((entry) => entry.key.toLowerCase() === 'portta.hostname')
      if (assigned) node.set(assigned.index!, `portta.hostname=\${${key}}`)
      else node.add(`portta.hostname=\${${key}}`)
    } else {
      node.set(rule.key, replacement)
      node.set('portta.hostname', `\${${key}}`)
    }
    labels[key] = canonical
    services.push(service)
  }
  return { text: services.length ? document.toString() : text, labels, services }
}

/** A recorded manual route is rewritten only when its entire Host rule is known. */
function migrateHttpTemplate(text: string, changes: HostnameMove[]): string {
  if (!text.includes('traefik.http.') || !changes.length) return text
  const document = parseDocument(text)
  if (document.errors.length)
    throw new RefusedError('cannot parse an HTTP integration for migration', document.errors[0]?.message)
  let changed = false
  for (const change of changes) {
    const node = document.getIn(['services', change.service, 'labels'], true)
    if (!isMap(node) && !isSeq(node)) continue
    const entries = isSeq(node)
      ? node.items.flatMap((item, index) => {
          const value = String(item)
          const at = value.indexOf('=')
          return at < 0 ? [] : [{ key: value.slice(0, at), value: value.slice(at + 1), index }]
        })
      : node.items.map((item) => ({ key: String(item.key), value: String(item.value), index: -1 }))
    const rules = entries.filter((entry) => /^traefik\.http\.routers\.[^.]+\.rule$/i.test(entry.key))
    for (const rule of rules) {
      if (rule.value === `Host(\`${change.newHost}\`)`) continue
      if (rule.value !== `Host(\`${change.oldHost}\`)`)
        throw new RefusedError(
          `the HTTP rule for ${change.project}/${change.service} needs an explicit migration`,
          rule.key,
        )
      if (isSeq(node)) node.set(rule.index, `${rule.key}=Host(\`${change.newHost}\`)`)
      else node.set(rule.key, `Host(\`${change.newHost}\`)`)
      changed = true
    }
  }
  return changed ? document.toString() : text
}

function owner(project: string, service: string): string {
  return JSON.stringify([project, service])
}

/** Pure with respect to the host: reads files and an already captured Docker inventory, writes nothing. */
export function planHostnameMigration(
  root: string,
  config: Pick<GatewayConfig, 'domain' | 'network' | 'profile' | 'publicDomain'>,
  containers: ContainerRecord[] = [],
): HostnameMigration {
  const paths = exposurePaths(root)
  const oldStore = readProtectionStore(paths.store)
  const targets = new Map<string, string>()
  const moves = new Map<string, HostnameMove>()
  const byOldHost = new Map<string, HostnameMove>()
  const files = new Map<string, Replacement>()
  const addFile = (path: string, after: string) => {
    const before = textAt(path)
    if (before !== after) files.set(path, { path, before, after })
  }
  const claim = (host: string, project: string, service: string) => {
    const identity = owner(project, service)
    const existing = targets.get(host)
    if (existing && existing !== identity) throw new RefusedError(`hostname collision at ${host}`)
    targets.set(host, identity)
  }
  const move = (change: HostnameMove) => {
    claim(change.newHost, change.project, change.service)
    if (change.oldHost === change.newHost) return
    const previous = byOldHost.get(change.oldHost)
    if (previous && owner(previous.project, previous.service) !== owner(change.project, change.service))
      throw new RefusedError(`ambiguous ownership of ${change.oldHost}`)
    byOldHost.set(change.oldHost, change)
    moves.set(`${change.oldHost}\0${change.newHost}`, change)
  }

  const runtimeRoot = join(root, 'runtime/compose')
  const namespaces = new Map<string, string>()
  const generatedNames = new Map<string, string>()
  for (const id of existsSync(runtimeRoot) ? readdirSync(runtimeRoot).sort() : []) {
    const planFile = join(runtimeRoot, id, 'plan.json')
    if (!existsSync(planFile)) continue
    const plan = JSON.parse(readFileSync(planFile, 'utf8')) as RuntimePlan
    if (plan.version !== 1 || plan.driver !== 'compose' || !plan.compose?.projectName || !Array.isArray(plan.services))
      throw new RefusedError(`invalid Runtime Plan at ${planFile}`)
    const project = plan.compose.projectName
    const workspace = resolve(plan.workspace)
    const previousWorkspace = namespaces.get(project)
    if (previousWorkspace && previousWorkspace !== workspace)
      throw new RefusedError(`Compose namespace ${project} belongs to more than one workspace`)
    namespaces.set(project, workspace)
    if (resolve(plan.compose.generatedOverlay) !== resolve(runtimeRoot, id, 'compose.portta.yaml'))
      throw new RefusedError(`Runtime Plan overlay is outside its directory: ${planFile}`)
    const next = structuredClone(plan)
    if (plan.compose.mode === 'auto')
      for (const service of next.services.filter((service) => service.route === 'http')) {
        const name = `${project}-${service.name}`.toLowerCase()
        const identity = owner(project, service.name)
        if (generatedNames.has(name) && generatedNames.get(name) !== identity)
          throw new RefusedError(`Traefik identifier collision at ${name}`)
        generatedNames.set(name, identity)
      }
    for (const service of next.services) {
      if (service.route !== 'http') continue
      if (!service.host) throw new RefusedError(`routed service ${project}/${service.name} has no recorded hostname`)
      if (!generatedOrigin(service.host, project, service.name)) {
        if (plan.compose.mode === 'manual') {
          claim(service.host, project, service.name)
          continue
        }
        throw new RefusedError(`the generated origin of ${service.host} is not established`)
      }
      const newHost = hostnameFor({ project, service: service.name }, config.domain)
      move({ project, service: service.name, oldHost: service.host, newHost, kind: 'service' })
      service.host = newHost
    }
    for (const source of next.compose.files) {
      const text = textAt(source)
      if (text === null) continue
      const http = migrateHttpTemplate(
        text,
        [...moves.values()].filter((change) => change.project === project && change.kind === 'service'),
      )
      const tcp = migrateTcpTemplate(http, project)
      if (tcp.text !== text) addFile(source, tcp.text)
      if (!tcp.services.length) continue
      const envFile = join(workspace, '.env')
      let environment = files.get(envFile)?.after ?? textAt(envFile) ?? ''
      for (const [key, value] of Object.entries(tcp.labels)) environment = setEnvValue(environment, key, value)
      addFile(envFile, environment)
      if (!next.inputs.some((input) => input.path === envFile))
        next.inputs.push({ path: envFile, digest: digest(environment) })
      for (const service of tcp.services)
        move({
          project,
          service,
          oldHost: `${retiredLabel(project, service)}.${config.domain}`,
          newHost: hostnameFor({ project, service }, config.domain),
          kind: 'service',
        })
    }
    for (const input of next.inputs ?? []) {
      const replacement = files.get(input.path)
      if (replacement) input.digest = digest(replacement.after)
    }
    addFile(planFile, `${JSON.stringify(next, null, 2)}\n`)
    if (next.compose.mode === 'auto') addFile(next.compose.generatedOverlay, renderRuntimeOverlay(next, config.network))
  }

  for (const container of containers) {
    const project = container.labels['com.docker.compose.project']
    if (!project || !namespaces.has(project)) continue
    const workspace = container.labels['com.docker.compose.project.working_dir']
    if (!workspace || resolve(workspace) !== namespaces.get(project))
      throw new RefusedError(`Compose namespace ${project} is used by another or unidentified workspace`)
  }

  const dynamic = join(root, 'config/traefik/dynamic')
  const shareFile = join(dynamic, 'portta-shares.yaml')
  const shareText = textAt(shareFile)
  const shareLine = shareText?.split('\n').find((line) => line.startsWith(SHARES_MARKER))
  if (shareText && !shareLine) throw new RefusedError(`shares have no identity metadata: ${shareFile}`)
  const shares = shareLine ? z.array(Share).parse(JSON.parse(shareLine.slice(SHARES_MARKER.length))) : []
  const nextShares = shares.map((share) => {
    const base = domainOf(share.host)
    const newHost = `${hostnameFromLabel(shareLabel({ project: share.project, service: share.service, id: share.id }), base)}${portOf(share.host)}`
    move({ project: share.project, service: share.service, oldHost: share.host, newHost, kind: 'share' })
    return { ...share, host: newHost }
  })
  if (shareText !== null) addFile(shareFile, renderShares(nextShares))

  for (const record of oldStore.protections) {
    if (byOldHost.has(record.host) || !record.project || !record.service) continue
    const base = domainOf(record.host)
    if (!generatedOrigin(record.host, record.project, record.service)) continue
    move({
      project: record.project,
      service: record.service,
      oldHost: record.host,
      newHost: `${hostnameFor({ project: record.project, service: record.service }, base)}${portOf(record.host)}`,
      kind: 'service',
    })
  }

  const aliasFile = join(dynamic, 'portta-aliases.yaml')
  const aliasText = textAt(aliasFile)
  if (aliasText && !aliasText.split('\n').some((line) => line.startsWith(ALIASES_MARKER)))
    throw new RefusedError(`aliases have no identity metadata: ${aliasFile}`)
  const aliases = parseAliases(aliasText)
  for (const alias of aliases) claim(alias.host, alias.project, alias.service)
  for (const container of containers) {
    const project = container.labels['com.docker.compose.project'] ?? container.name
    const service = container.labels['com.docker.compose.service'] ?? container.name
    if (!traefikEnabled(container.labels) || isTcpOnly(container.labels)) continue
    const labels = readTraefikLabels(container.labels).labels
    for (const name of [...traefikServiceNames(labels), ...httpRouterNames(labels)]) {
      const expected = generatedNames.get(name)
      if (expected && expected !== owner(project, service))
        throw new RefusedError(`Traefik identifier ${name} belongs to ${container.name}`)
    }
    const routes = httpRoutes(container.labels)
    for (const host of routes.hosts) claim(host, project, service)
    if (routes.usesDefaultRule)
      claim(`${hostLabelFromLabels(container.labels, container.name)}.${config.domain}`, project, service)
  }

  // Check the complete target set before changing any record, including conflicts with custom hosts.
  const nextHosts = new Set<string>()
  for (const record of oldStore.protections) {
    const change = byOldHost.get(record.host)
    if (
      change &&
      ((record.project && record.project !== change.project) || (record.service && record.service !== change.service))
    )
      throw new RefusedError(`the protection for ${record.host} belongs to another service`)
    const host = change?.newHost ?? record.host
    if (nextHosts.has(host)) throw new RefusedError(`multiple protection records would claim ${host}`)
    nextHosts.add(host)
    if (record.project && record.service) claim(host, record.project, record.service)
    else if (targets.has(host) && !change) throw new RefusedError(`the owner of protection ${host} is not recorded`)
  }
  let store = oldStore
  for (const record of oldStore.protections) {
    const change = byOldHost.get(record.host)
    if (!change || record.host === change.newHost) continue
    const { epoch: _epoch, ...preserved } = record
    store = setProtection(store, { ...preserved, host: change.newHost })
  }
  store = parseProtectionStore(JSON.stringify(store))
  const storeChanged = JSON.stringify(store) !== JSON.stringify(oldStore)
  if (storeChanged) {
    addFile(paths.store, `${JSON.stringify(store, null, 2)}\n`)
    addFile(paths.dynamic, renderAuthDynamic(store))
  }
  const nextAliases: StoredAlias[] = aliases.filter((alias) => {
    const change = byOldHost.get(alias.host)
    return !change || change.project !== alias.project || change.service !== alias.service
  })
  if (aliasText !== null)
    addFile(aliasFile, renderAliasesForStore(nextAliases, store, config.profile === 'remote-public'))
  return { root, profile: config.profile, moves: [...moves.values()], files: [...files.values()], store, storeChanged }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}

/** Applies only prepared state. It never starts, stops or recreates an application. */
export function applyHostnameMigration(plan: HostnameMigration): string | null {
  if (!plan.files.length) return null
  for (const file of plan.files) {
    if (textAt(file.path) !== file.before) throw new RefusedError(`file changed after migration preview: ${file.path}`)
  }
  const directory = join(plan.root, 'state/migrations/hostnames')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lock = join(directory, '.writer')
  let descriptor: number
  try {
    descriptor = openSync(lock, 'wx', 0o600)
  } catch {
    throw new RefusedError('hostname migration is locked', `check the writer before removing ${lock}`)
  }
  try {
    const backup = join(directory, `${Date.now()}-${randomBytes(4).toString('hex')}`)
    mkdirSync(backup, { recursive: true, mode: 0o700 })
    chmodSync(dirname(backup), 0o700)
    const extra = [
      '.env',
      'VERSION',
      'state/auth/protections.json',
      'config/traefik/dynamic/portta-auth.yaml',
      'config/traefik/dynamic/portta-aliases.yaml',
      'config/traefik/dynamic/portta-shares.yaml',
    ]
      .map((path) => join(plan.root, path))
      .filter(existsSync)
    const paths = [...new Set([...plan.files.map((file) => file.path), ...extra])]
    const saved = paths.map((path, index) => {
      const contents = textAt(path)
      const name = `${index}.before`
      if (contents !== null) writeFileSync(join(backup, name), contents, { mode: 0o600 })
      return {
        path,
        backup: contents === null ? null : name,
        mode: contents === null ? null : statSync(path).mode & 0o777,
        digest: contents === null ? null : digest(contents),
      }
    })
    const journal = { version: 1, status: 'prepared', moves: plan.moves, files: saved }
    const journalFile = join(backup, 'migration.json')
    atomicWrite(journalFile, `${JSON.stringify(journal, null, 2)}\n`)
    const writeReplacement = (file: Replacement) => {
      const current = textAt(file.path)
      if (current === file.after) return
      if (current !== file.before) throw new RefusedError(`file changed during hostname migration: ${file.path}`)
      if (basename(file.path) === '.env') writeEnvFile(file.path, file.after)
      else atomicWrite(file.path, file.after)
    }
    try {
      // Remove retired aliases before moving their access decisions. Every new protected route remains gated.
      for (const file of plan.files.filter((file) => file.path.endsWith('/portta-aliases.yaml'))) writeReplacement(file)
      if (plan.storeChanged) saveExposure(plan.root, plan.store, plan.profile)
      for (const file of plan.files) {
        if (file.path === exposurePaths(plan.root).store || file.path === exposurePaths(plan.root).dynamic) continue
        writeReplacement(file)
      }
      journal.status = 'complete'
      atomicWrite(journalFile, `${JSON.stringify(journal, null, 2)}\n`)
    } catch (error) {
      journal.status = 'incomplete'
      atomicWrite(journalFile, `${JSON.stringify(journal, null, 2)}\n`)
      throw error
    }
    return backup
  } finally {
    closeSync(descriptor)
    unlinkSync(lock)
  }
}

export async function migrateHostnames(options: { apply?: boolean }, command: Command): Promise<void> {
  const global = command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
  const context = gatewayContext({ profile: global.profile })
  const containers = await inspectContainers(true)
  const plan = planHostnameMigration(context.root, context.config, containers)
  if (
    options.apply &&
    plan.files.length &&
    containers.some(
      (container) =>
        container.state === 'running' &&
        container.labels['com.docker.compose.project'] === context.config.projectName &&
        container.labels['com.docker.compose.service'] === 'web',
    )
  )
    throw new RefusedError(
      'stop the panel before applying hostname migration',
      'run `portta web down`; applications stay running',
    )
  const backup = options.apply ? applyHostnameMigration(plan) : null
  const result = {
    applied: Boolean(options.apply),
    changed: plan.files.length > 0,
    moves: plan.moves,
    files: plan.files.map((file) => file.path),
    backup,
  }
  const output = new Output(global)
  if (output.json) output.data(result)
  else {
    for (const move of plan.moves) output.line(`${move.project}/${move.service}\t${move.oldHost} -> ${move.newHost}`)
    output.line(
      `${options.apply ? 'Applied' : 'Preview'}: ${plan.files.length} file(s), ${plan.moves.length} hostname(s)`,
    )
    if (backup) output.line(`Backup: ${backup}`)
    if (!options.apply && plan.files.length)
      output.line('Run with --apply while the panel is stopped; no application is started by this command.')
  }
}
