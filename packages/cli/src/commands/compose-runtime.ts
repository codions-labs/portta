import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path'
import type { Command } from 'commander'
import { branchSuffix, composeNamespace, parseEnv } from 'portta-core'
import { z } from 'portta-core/zod'
import { gatewayContext } from '../context.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

const Manifest = z.object({
  schemaVersion: z.literal(1),
  driver: z.literal('compose').default('compose'),
  compose: z
    .object({
      files: z.array(z.string().min(1)).min(1).optional(),
      profiles: z.array(z.string().min(1)).default([]),
      mode: z.enum(['auto', 'manual']).default('auto'),
    })
    .default({ profiles: [], mode: 'auto' }),
  services: z
    .record(
      z.string(),
      z.object({ http: z.object({ port: z.number().int().positive() }).optional(), expose: z.boolean().optional() }),
    )
    .default({}),
  compatibility: z
    .object({
      removeContainerNames: z.array(z.string().min(1)).default([]),
      allowSharedNetworks: z.boolean().default(false),
      allowSharedVolumes: z.boolean().default(false),
    })
    .default({ removeContainerNames: [], allowSharedNetworks: false, allowSharedVolumes: false }),
})
const Service = z
  .object({
    image: z.string().optional(),
    ports: z.array(z.unknown()).optional(),
    expose: z.array(z.union([z.string(), z.number()])).optional(),
    networks: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
    network_mode: z.string().optional(),
    container_name: z.string().optional(),
    volumes: z
      .array(
        z.union([z.string(), z.object({ source: z.string().optional(), type: z.string().optional() }).passthrough()]),
      )
      .optional(),
    privileged: z.boolean().optional(),
    devices: z.array(z.string()).optional(),
    pid: z.string().optional(),
    ipc: z.string().optional(),
  })
  .passthrough()
const Model = z
  .object({
    name: z.string().optional(),
    services: z.record(z.string(), Service),
    volumes: z
      .record(
        z.string(),
        z
          .object({
            external: z.union([z.boolean(), z.object({}).passthrough()]).optional(),
            name: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    networks: z
      .record(
        z.string(),
        z
          .object({
            external: z.union([z.boolean(), z.object({}).passthrough()]).optional(),
            name: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

type RuntimeManifest = z.infer<typeof Manifest>
type RuntimePlan = {
  version: 1
  driver: 'compose'
  id: string
  workspace: string
  createdAt: string
  inputs: Array<{ path: string; digest: string }>
  capabilities: { composeVersion: string }
  manifest: { local: { path: string; digest: string | null }; stored: { path: string; digest: string | null } }
  compose: {
    projectName: string
    projectDirectory: string
    files: string[]
    profiles: string[]
    mode: 'auto' | 'manual'
    generatedOverlay: string
  }
  outcome: 'isolated' | 'manual' | 'not_supported'
  compatibility: { removeContainerNames: string[]; allowSharedNetworks: boolean; allowSharedVolumes: boolean }
  pending: Array<{ code: string; service?: string; detail: string; option: string }>
  services: Array<{
    name: string
    containerPort: number | null
    route: 'http' | 'none'
    networks: string[]
    networkMerge: 'merge' | 'replace'
    removeContainerName: boolean
  }>
  findings: Array<{ code: string; service?: string; detail: string }>
}

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
    yes?: boolean
  }
}
function idFor(workspace: string): string {
  return createHash('sha256').update(workspace).digest('hex').slice(0, 16)
}
function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
function digestIfPresent(path: string): string | null {
  return existsSync(path) ? digest(path) : null
}
function runtimeDirectory(root: string, id: string): string {
  return join(root, 'runtime', 'compose', id)
}
function planPath(root: string, id: string): string {
  return join(runtimeDirectory(root, id), 'plan.json')
}
function manifestPath(root: string, id: string): string {
  return join(runtimeDirectory(root, id), 'runtime.json')
}
function composeCandidates(workspace: string): string[] {
  return ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
    .map((file) => join(workspace, file))
    .filter(existsSync)
}
export function hasComposeRuntime(workspace = process.cwd()): boolean {
  return composeCandidates(resolve(workspace)).length > 0 && !existsSync(join(resolve(workspace), 'VERSION'))
}
function networks(value: z.infer<typeof Service>['networks']): string[] {
  return Array.isArray(value) ? value : Object.keys(value ?? {})
}
function portOf(service: z.infer<typeof Service>): number | null {
  const value = service.ports?.[0] ?? service.expose?.[0]
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(/([^:]+)(?:\/\w+)?$/.exec(value)?.[1] ?? '') || null
  if (value && typeof value === 'object' && 'target' in value && typeof value.target === 'number') return value.target
  return null
}
function portsOf(service: z.infer<typeof Service>): number[] {
  return [
    ...new Set(
      [...(service.ports ?? []), ...(service.expose ?? [])]
        .flatMap((value) => {
          if (typeof value === 'number') return [value]
          if (typeof value === 'string') return [Number(/([^:]+)(?:\/\w+)?$/.exec(value)?.[1] ?? '') || 0]
          if (value && typeof value === 'object' && 'target' in value && typeof value.target === 'number')
            return [value.target]
          return []
        })
        .filter(Boolean),
    ),
  ]
}
function bindMount(mount: NonNullable<z.infer<typeof Service>['volumes']>[number]): boolean {
  if (typeof mount !== 'string') return mount.type === 'bind'
  const source = mount.split(':', 1)[0] ?? ''
  return (
    source === '.' ||
    source === '..' ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('/') ||
    source.startsWith('~/')
  )
}
function httpCandidate(name: string, service: z.infer<typeof Service>): boolean {
  return (
    /(^|[-_])(web|app|api|frontend|backend|site|www|http|nginx|server|ui|admin|dashboard|gateway|storefront)([-_]|$)/i.test(
      name,
    ) ||
    /nginx|httpd|apache|caddy|traefik|node|php|python|ruby|golang|openresty|haproxy|whoami|frankenphp/i.test(
      service.image ?? '',
    )
  )
}
function yaml(value: string): string {
  return JSON.stringify(value)
}
function overlay(plan: RuntimePlan, network: string): string {
  const blocks = plan.services
    .map((service) => {
      const reset = `    ports: !reset []\n`
      const containerName = service.removeContainerName ? '    container_name: !reset null\n' : ''
      if (service.route === 'none') return `  ${service.name}:\n${reset}${containerName}`
      const privateNetworks = service.networks.filter((name) => name !== 'portta')
      const finalNetworks = [...(privateNetworks.length ? privateNetworks : ['default']), 'portta']
      return `  ${service.name}:\n${reset}${containerName}    networks:${service.networkMerge === 'replace' ? ' !override' : ''}\n${finalNetworks.map((name) => `      - ${name}`).join('\n')}\n    labels:\n      - ${yaml('traefik.enable=true')}\n      - ${yaml(`traefik.docker.network=${network}`)}\n      - ${yaml(`traefik.http.services.${plan.compose.projectName}-${service.name}.loadbalancer.server.port=${service.containerPort}`)}`
    })
    .join('\n\n')
  return `# Generated by Portta. Source Compose files are immutable.\nservices:\n${blocks}\n\nnetworks:\n  portta:\n    external: true\n    name: ${yaml(network)}\n`
}

function manifestPaths(workspace: string, root: string, id: string) {
  return { local: join(workspace, '.portta', 'runtime.json'), stored: manifestPath(root, id) }
}
function loadManifest(workspace: string, root: string, id: string): RuntimeManifest {
  const { local, stored } = manifestPaths(workspace, root, id)
  const file = existsSync(local) ? local : existsSync(stored) ? stored : null
  return file ? Manifest.parse(JSON.parse(readFileSync(file, 'utf8'))) : Manifest.parse({ schemaVersion: 1 })
}
function inputFiles(workspace: string, manifest: RuntimeManifest): string[] {
  if (manifest.compose.files?.length) return manifest.compose.files.map((file) => resolve(workspace, file))
  const envFile = join(workspace, '.env')
  const env = envFile && existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : new Map<string, string>()
  const configured = process.env.COMPOSE_FILE ?? env.get('COMPOSE_FILE')
  if (configured) return configured.split(delimiter).map((file) => (isAbsolute(file) ? file : resolve(workspace, file)))
  const base = composeCandidates(workspace)[0]
  if (!base) throw new UsageError(`no Compose file found in ${workspace}`)
  const override = ['compose.override.yaml', 'compose.override.yml']
    .map((file) => join(workspace, file))
    .find(existsSync)
  return override ? [base, override] : [base]
}
function versionAtLeast(value: string, minimum = [2, 24, 4]): boolean {
  const parts = value
    .replace(/^v/, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number(part))
  for (let index = 0; index < minimum.length; index += 1) {
    const actual = parts[index] ?? 0
    const required = minimum[index]!
    if (actual !== required) return actual > required
  }
  return true
}
async function requireCompose(): Promise<string> {
  const version = await runProcess('docker', ['compose', 'version', '--short'], { reject: false })
  if (version.exitCode !== 0 || !versionAtLeast(version.stdout.trim()))
    throw new PreconditionError(
      'Docker Compose 2.24.4 or newer is required for generated runtime overlays',
      'upgrade Docker Compose before running this environment',
    )
  return version.stdout.trim()
}
async function gitBranch(workspace: string): Promise<string | null> {
  const result = await runProcess('git', ['-C', workspace, 'branch', '--show-current'], { reject: false })
  return result.exitCode === 0 ? result.stdout.trim() || null : null
}
function composeArgs(plan: RuntimePlan, overlayFile = plan.compose.generatedOverlay): string[] {
  return [
    'compose',
    '-p',
    plan.compose.projectName,
    '--project-directory',
    plan.workspace,
    ...plan.compose.files.flatMap((file) => ['-f', file]),
    '-f',
    overlayFile,
    ...plan.compose.profiles.flatMap((profile) => ['--profile', profile]),
  ]
}
async function stale(plan: RuntimePlan): Promise<boolean> {
  // A plan without manifest tracking is stale and is regenerated rather than
  // failing on missing fields.
  if (!('manifest' in plan) || !('capabilities' in plan) || !existsSync(plan.compose.generatedOverlay)) return true
  return (
    plan.capabilities.composeVersion !== (await requireCompose()) ||
    plan.inputs.some((input) => !existsSync(input.path) || digest(input.path) !== input.digest) ||
    digestIfPresent(plan.manifest.local.path) !== plan.manifest.local.digest ||
    digestIfPresent(plan.manifest.stored.path) !== plan.manifest.stored.digest
  )
}
function readPlan(root: string, workspace: string): RuntimePlan {
  const path = planPath(root, idFor(workspace))
  if (!existsSync(path)) throw new UsageError('no Runtime Plan exists for this workspace', 'run `portta prepare` first')
  return JSON.parse(readFileSync(path, 'utf8')) as RuntimePlan
}

type AdoptionOptions = {
  path?: string
  service?: string[]
  project?: string
  dryRun?: boolean
  manual?: boolean
  removeContainerName?: string[]
  allowSharedNetworks?: boolean
  allowSharedVolumes?: boolean
}

function manifestWithOptions(manifest: RuntimeManifest, options: AdoptionOptions): RuntimeManifest {
  return Manifest.parse({
    ...manifest,
    compose: { ...manifest.compose, mode: options.manual ? 'manual' : manifest.compose.mode },
    compatibility: {
      ...manifest.compatibility,
      removeContainerNames: options.removeContainerName?.length
        ? options.removeContainerName
        : manifest.compatibility.removeContainerNames,
      allowSharedNetworks: options.allowSharedNetworks || manifest.compatibility.allowSharedNetworks,
      allowSharedVolumes: options.allowSharedVolumes || manifest.compatibility.allowSharedVolumes,
    },
  })
}

export async function prepareComposeRuntime(options: AdoptionOptions, command: Command): Promise<RuntimePlan> {
  const output = new Output(globals(command))
  const workspace = resolve(options.path ?? process.cwd())
  const context = gatewayContext({ profile: globals(command).profile })
  const composeVersion = await requireCompose()
  const id = idFor(workspace)
  const manifest = manifestWithOptions(loadManifest(workspace, context.root, id), options)
  const files = inputFiles(workspace, manifest)
  if (files.some((file) => !existsSync(file)))
    throw new UsageError(`a Compose input does not exist: ${files.find((file) => !existsSync(file))}`)
  const branch = await gitBranch(workspace)
  const projectName = options.project ?? composeNamespace(basename(workspace), branchSuffix(branch ?? ''))
  const first = await runProcess(
    'docker',
    [
      ...['compose', '-p', projectName, '--project-directory', workspace],
      ...files.flatMap((file) => ['-f', file]),
      ...manifest.compose.profiles.flatMap((profile) => ['--profile', profile]),
      'config',
      '--format',
      'json',
    ],
    { cwd: workspace, reject: false },
  )
  if (first.exitCode !== 0)
    throw new RefusedError('source Compose model is not valid', first.stderr.trim() || first.stdout.trim())
  const model = Model.parse(JSON.parse(first.stdout))
  const explicit = new Map(
    (options.service ?? []).map((value) => {
      const match = /^([\w.-]+):(\d+)$/.exec(value)
      if (!match) throw new UsageError(`invalid --service value: ${value}; expected name:port`)
      return [match[1]!, Number(match[2])]
    }),
  )
  const findings: RuntimePlan['findings'] = []
  const pending: RuntimePlan['pending'] = []
  const services = Object.entries(model.services).map(([name, service]) => {
    const intent = manifest.services[name]
    const explicitPort = explicit.get(name)
    const ports = portsOf(service)
    const inferred = intent?.expose !== false && httpCandidate(name, service) && ports.length === 1
    if (
      intent?.expose !== false &&
      httpCandidate(name, service) &&
      ports.length > 1 &&
      explicitPort === undefined &&
      intent?.http === undefined
    ) {
      findings.push({
        code: 'ambiguous_port',
        service: name,
        detail: `${name} exposes multiple ports and needs an explicit HTTP surface`,
      })
      pending.push({
        code: 'ambiguous_port',
        service: name,
        detail: `${name} exposes multiple ports; keep it private or pass --service ${name}:<port>`,
        option: `--service ${name}:<port>`,
      })
    }
    const candidate = explicitPort !== undefined || intent?.http !== undefined || inferred
    const port = explicitPort ?? intent?.http?.port ?? portOf(service)
    if (candidate && service.network_mode)
      findings.push({
        code: 'network_mode',
        service: name,
        detail: `${name} uses network_mode=${service.network_mode} and cannot join the Portta network`,
      })
    const removeContainerName = manifest.compatibility.removeContainerNames.includes(name)
    if (service.container_name) {
      findings.push({
        code: 'container_name',
        service: name,
        detail: `${name} sets container_name=${service.container_name}, which is not isolated by Compose project name`,
      })
      if (!removeContainerName)
        pending.push({
          code: 'container_name',
          service: name,
          detail: `${name} has container_name=${service.container_name}; removing it can change service discovery`,
          option: `--remove-container-name ${name}`,
        })
    }
    if (service.privileged || service.devices?.length || service.pid === 'host' || service.ipc === 'host')
      findings.push({ code: 'privileged', service: name, detail: `${name} requests host-level privileges` })
    for (const mount of service.volumes ?? [])
      if (bindMount(mount))
        findings.push({ code: 'bind_mount', service: name, detail: `${name} uses a host bind mount` })
    const networkMerge =
      Array.isArray(service.networks) || Object.values(service.networks ?? {}).every((value) => value === null)
        ? ('replace' as const)
        : ('merge' as const)
    return {
      name,
      containerPort: candidate ? port : null,
      route: candidate && port ? ('http' as const) : ('none' as const),
      networks: networks(service.networks),
      networkMerge,
      removeContainerName,
    }
  })
  for (const [name, volume] of Object.entries(model.volumes ?? {}))
    if (volume.external || (volume.name && volume.name !== `${projectName}_${name}`)) {
      findings.push({ code: 'shared_volume', detail: `volume ${name} is external or uses a fixed name` })
      if (!manifest.compatibility.allowSharedVolumes)
        pending.push({
          code: 'shared_volume',
          detail: `volume ${name} is external or fixed and may share data between environments`,
          option: '--allow-shared-volumes',
        })
    }
  for (const [name, value] of Object.entries(model.networks ?? {}))
    if (name !== 'portta' && (value.external || (value.name && value.name !== `${projectName}_${name}`))) {
      findings.push({ code: 'shared_network', detail: `network ${name} is external or uses a fixed name` })
      if (!manifest.compatibility.allowSharedNetworks)
        pending.push({
          code: 'shared_network',
          detail: `network ${name} is external or fixed and may connect environments`,
          option: '--allow-shared-networks',
        })
    }
  for (const name of manifest.compatibility.removeContainerNames)
    if (!model.services[name]) throw new UsageError(`no service named ${name} for --remove-container-name`)
  const unsupported = findings.filter((finding) => finding.code === 'network_mode')
  const outcome: RuntimePlan['outcome'] = unsupported.length
    ? 'not_supported'
    : manifest.compose.mode === 'manual'
      ? 'manual'
      : pending.length
        ? 'not_supported'
        : 'isolated'
  const directory = runtimeDirectory(context.root, id)
  const generatedOverlay = join(directory, 'compose.portta.yaml')
  const manifests = manifestPaths(workspace, context.root, id)
  const envFile = join(workspace, '.env')
  const plan: RuntimePlan = {
    version: 1,
    driver: 'compose',
    id,
    workspace,
    createdAt: new Date().toISOString(),
    inputs: [...files, ...(existsSync(envFile) ? [envFile] : [])].map((file) => ({ path: file, digest: digest(file) })),
    capabilities: { composeVersion },
    manifest: {
      local: { path: manifests.local, digest: digestIfPresent(manifests.local) },
      stored: { path: manifests.stored, digest: digestIfPresent(manifests.stored) },
    },
    compose: {
      projectName,
      projectDirectory: workspace,
      files,
      profiles: manifest.compose.profiles,
      mode: manifest.compose.mode,
      generatedOverlay,
    },
    outcome,
    compatibility: manifest.compatibility,
    pending,
    services,
    findings,
  }
  const content =
    manifest.compose.mode === 'manual'
      ? '# Manual Compose integration; Portta adds no runtime mutations.\nservices: {}\n'
      : overlay(plan, context.config.network)
  if (!options.dryRun) {
    if (outcome === 'not_supported')
      throw new RefusedError(
        'environment is not ready for isolated Compose runtime',
        [...unsupported, ...pending].map((finding) => finding.detail).join('; '),
      )
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = `${generatedOverlay}.${process.pid}.tmp`
    writeFileSync(temporary, content, { mode: 0o600 })
    const final = await runProcess('docker', [...composeArgs(plan, temporary), 'config', '--format', 'json'], {
      cwd: workspace,
      reject: false,
    })
    if (final.exitCode !== 0) {
      rmSync(temporary, { force: true })
      throw new RefusedError(
        'generated runtime overlay is not valid Compose',
        final.stderr.trim() || final.stdout.trim(),
      )
    }
    const finalModel = Model.parse(JSON.parse(final.stdout))
    if (
      manifest.compose.mode === 'auto' &&
      Object.values(finalModel.services).some((service) => service.ports?.length)
    ) {
      rmSync(temporary, { force: true })
      throw new RefusedError('generated runtime still publishes host ports')
    }
    renameSync(temporary, generatedOverlay)
    writeFileSync(planPath(context.root, id), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 })
  }
  if (output.json) output.data(plan)
  else {
    output.line(`Outcome: ${outcome}`)
    output.line(`Environment: ${plan.id}`)
    output.line(`Compose project: ${projectName}`)
    for (const service of services)
      output.line(`  ${service.name}\t${service.route === 'http' ? `:${service.containerPort} -> routed` : 'private'}`)
    for (const finding of findings) output.warning(finding.detail)
    for (const decision of pending) output.line(`Decision: ${decision.option}`)
  }
  return plan
}

/** Save only declarative exposure intent in Portta state; the source repository stays untouched. */
export async function initComposeRuntime(options: AdoptionOptions, command: Command): Promise<RuntimePlan> {
  const workspace = resolve(options.path ?? process.cwd())
  const context = gatewayContext({ profile: globals(command).profile })
  const id = idFor(workspace)
  const services = Object.fromEntries(
    (options.service ?? []).map((value) => {
      const match = /^([\w.-]+):(\d+)$/.exec(value)
      if (!match) throw new UsageError(`invalid --service value: ${value}; expected name:port`)
      return [match[1]!, { http: { port: Number(match[2]) } }]
    }),
  )
  const files = inputFiles(workspace, Manifest.parse({ schemaVersion: 1 }))
  const manifest = {
    schemaVersion: 1,
    driver: 'compose',
    compose: {
      files: files.map((file) => (file.startsWith(`${workspace}/`) ? file.slice(workspace.length + 1) : file)),
      profiles: [],
      mode: options.manual ? 'manual' : 'auto',
    },
    services,
    compatibility: {
      removeContainerNames: options.removeContainerName ?? [],
      allowSharedNetworks: options.allowSharedNetworks ?? false,
      allowSharedVolumes: options.allowSharedVolumes ?? false,
    },
  }
  const directory = runtimeDirectory(context.root, id)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(manifestPath(context.root, id), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return prepareComposeRuntime({ path: workspace, project: options.project }, command)
}

/** Canonical closed workflow for adopting a Compose project without modifying it. */
export async function adoptComposeRuntime(options: AdoptionOptions, command: Command): Promise<RuntimePlan> {
  return options.dryRun ? prepareComposeRuntime(options, command) : initComposeRuntime(options, command)
}

export async function runtimeAction(
  action: 'up' | 'down' | 'restart' | 'status' | 'logs' | 'config',
  options: { path?: string; service?: string; follow?: boolean; tail?: string },
  command: Command,
): Promise<void> {
  const workspace = resolve(options.path ?? process.cwd())
  const context = gatewayContext({ profile: globals(command).profile })
  let plan: RuntimePlan
  if (action === 'up') {
    try {
      plan = readPlan(context.root, workspace)
      if (await stale(plan))
        plan = await prepareComposeRuntime({ path: workspace, project: plan.compose.projectName }, command)
    } catch (error) {
      if (!(error instanceof UsageError)) throw error
      plan = await prepareComposeRuntime({ path: workspace }, command)
    }
  } else plan = readPlan(context.root, workspace)
  const args = composeArgs(plan)
  const tail = options.tail ? ['--tail', options.tail] : []
  const commandArgs =
    action === 'up'
      ? [...args, 'up', '-d']
      : action === 'down'
        ? [...args, 'down']
        : action === 'restart'
          ? [...args, 'restart']
          : action === 'status'
            ? [...args, 'ps']
            : action === 'logs'
              ? [
                  ...args,
                  'logs',
                  ...(options.follow === false ? ['--no-follow'] : ['--follow']),
                  ...tail,
                  ...(options.service ? [options.service] : []),
                ]
              : [...args, 'config']
  await runProcess('docker', commandArgs, { cwd: workspace, stdio: action === 'logs' ? 'inherit' : 'stream' })
}
