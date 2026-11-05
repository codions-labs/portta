import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import {
  branchSuffix,
  COMPOSE_DEPENDS_ON,
  type ContainerRecord,
  composeNamespace,
  defaultProjectConfig,
  environmentNamespace,
  hostLabel,
  hostnameFor,
  orderProjectServices,
  PROJECT_CONFIG_PATH,
  type ProjectConfig,
  type ProjectConfigIssue,
  parseDependsOn,
  parseEnv,
  parseProjectConfig,
  projectsFor,
  traefikEnabled,
} from 'portta-core'
import { z } from 'portta-core/zod'
import { parse as parseYaml } from 'yaml'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { readPlan } from './compose-runtime.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

export async function projectList(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const projects = projectsFor(
    await inspectContainers(),
    context.config.domain,
    context.config.tlsEnabled ? 'https' : 'http',
  ).filter((project) => !options.project || project.name === options.project)
  const output = new Output(global)
  if (output.json)
    output.data({
      instance: { name: context.config.projectName },
      projects: projects.map((project) => ({
        name: project.name,
        state: project.state,
        serviceCount: project.services.length,
        urls: project.urls,
      })),
    })
  else
    for (const project of projects)
      output.line(`${project.name}\t${project.state}\t${project.services.length} services\t${project.urls.length} urls`)
}

export async function projectShow(name: string, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const project = projectsFor(
    await inspectContainers(),
    context.config.domain,
    context.config.tlsEnabled ? 'https' : 'http',
  ).find((candidate) => candidate.name === name)
  if (!project) throw new UsageError(`project not found: ${name}`)
  const output = new Output(global)
  const value = {
    instance: { name: context.config.projectName },
    name: project.name,
    state: project.state,
    services: project.services.map((service) => ({
      name: service.labels['com.docker.compose.service'] ?? service.name,
      container: service.name,
      image: service.image,
      state: service.state,
      ports: service.ports,
      networks: service.networks,
    })),
    urls: project.urls,
  }
  if (output.json) output.data(value)
  else {
    output.line(`${project.name} · ${project.state}`)
    for (const service of value.services) output.line(`${service.name}\t${service.state}\t${service.image}`)
    for (const url of value.urls) output.line(url.url)
  }
}

function classify(image: string, name: string): string {
  const value = `${image} ${name}`.toLowerCase()
  if (/postgres|mysql|mariadb|mongo/.test(value)) return 'database'
  if (/redis|valkey|memcached/.test(value)) return 'cache'
  if (/rabbitmq|kafka|nats/.test(value)) return 'queue'
  return 'application'
}

export async function servicesCommand(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const services = (await inspectContainers())
    .filter(
      (container) =>
        container.labels['com.docker.compose.project'] &&
        (!options.project || container.labels['com.docker.compose.project'] === options.project),
    )
    .map((container) => ({
      project: container.labels['com.docker.compose.project']!,
      service: container.labels['com.docker.compose.service'] ?? container.name,
      container: container.name,
      state: container.state,
      kind: classify(container.image, container.name),
      ports: container.ports,
      networks: container.networks,
      routed: traefikEnabled(container.labels),
    }))
    .sort((a, b) => `${a.project}/${a.service}`.localeCompare(`${b.project}/${b.service}`))
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, services })
  else
    for (const service of services)
      output.line(`${service.project}\t${service.service}\t${service.kind}\t${service.state}`)
}

const ComposePort = z.union([
  z.string(),
  z.number(),
  z
    .object({
      target: z.union([z.string(), z.number()]).optional(),
      published: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough(),
])
const ComposeService = z
  .object({
    image: z.string().optional(),
    ports: z.array(ComposePort).optional(),
    container_name: z.string().optional(),
    expose: z.array(z.union([z.string(), z.number()])).optional(),
    networks: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
    volumes: z
      .array(
        z.union([z.string(), z.object({ source: z.string().optional(), target: z.string().optional() }).passthrough()]),
      )
      .optional(),
    labels: z
      .union([z.array(z.string()), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))])
      .optional(),
  })
  .passthrough()
const ComposeSchema = z
  .object({ name: z.string().optional(), services: z.record(z.string(), ComposeService) })
  .passthrough()
type ComposeService = z.infer<typeof ComposeService>

const DATASTORE =
  /postgres|postgis|timescale|mysql|mariadb|percona|redis|valkey|keydb|mongo|memcached|elasticsearch|opensearch|rabbitmq|kafka|clickhouse|cassandra|neo4j/i
const HTTP_IMAGE =
  /nginx|httpd|apache|caddy|traefik|node|php|python|ruby|golang|openresty|haproxy|whoami|frankenphp|mailpit|mailhog|rustfs|minio/i
const WORKER_NAME = /(^|[-_])(worker|queue|scheduler|cron|consumer|beat|migrator|migrate|init|seed|setup)([-_]|$)/i
const HTTP_NAME =
  /(^|[-_])(web|app|api|frontend|backend|site|www|http|nginx|server|ui|admin|dashboard|gateway)([-_]|$)/i

function classifyCompose(image: string, name: string): 'datastore' | 'http' | 'worker' | 'unknown' {
  if (WORKER_NAME.test(name)) return 'worker'
  // A PHP, Node or Python image can just as legitimately be a queue consumer.
  // The service's explicit worker-shaped name is stronger evidence than the
  // generic runtime image.
  if (DATASTORE.test(image)) return 'datastore'
  if (HTTP_IMAGE.test(image)) return 'http'
  if (HTTP_NAME.test(name)) return 'http'
  return 'unknown'
}

/** Splits a short port on the colons that are not inside `${...}`: `127.0.0.1:${PORT:-80}:80` has three parts. */
function portParts(port: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of port) {
    if (char === '{') depth += 1
    if (char === '}') depth = Math.max(0, depth - 1)
    if (char === ':' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

/**
 * The ports a service publishes on the host. A short port with a host part that cannot be classified (a
 * variable, a range) still counts as published: the review would otherwise say a port is private when it is not.
 */
export function publishedPorts(service: ComposeService): Array<{ host: string; container: string }> {
  return (service.ports ?? []).flatMap((port) => {
    if (typeof port === 'object' && port.published !== undefined)
      return [{ host: String(port.published), container: String(port.target ?? '') }]
    if (typeof port !== 'string') return []
    const parts = portParts(port)
    if (parts.length < 2) return []
    const host = parts[parts.length - 2]!.trim()
    const container = parts[parts.length - 1]!.replace(/\/\w+$/, '').trim()
    return host === '' ? [] : [{ host, container }]
  })
}

function containerPorts(service: ComposeService): string[] {
  const ports = (service.ports ?? []).flatMap((port) => {
    if (typeof port === 'object' && port.target !== undefined) return [String(port.target)]
    if (typeof port === 'number') return [String(port)]
    const match = /(?:^|:)(\d+)(?:\/\w+)?$/.exec(String(port))
    return match ? [match[1]!] : []
  })
  return [...new Set(ports)]
}

function labelsOf(service: ComposeService): Record<string, string> {
  if (Array.isArray(service.labels))
    return Object.fromEntries(
      service.labels.map((label) => {
        const at = label.indexOf('=')
        return [label.slice(0, at), label.slice(at + 1)]
      }),
    )
  return Object.fromEntries(Object.entries(service.labels ?? {}).map(([key, value]) => [key, String(value)]))
}

function composeCandidates(path: string): string[] {
  return ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
    .map((file) => join(path, file))
    .filter(existsSync)
}

/** The host's containers, or nothing when Docker cannot be asked: the report is read-only and still worth printing. */
async function hostContainers(): Promise<ContainerRecord[]> {
  try {
    return await inspectContainers()
  } catch {
    return []
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** A top-level `name:` written in the file itself. `docker compose config` always prints one, so it cannot tell. */
function declaredComposeName(file: string): string | null {
  const text = readSmallFile(file, COMPOSE_MAX_BYTES, true)
  if (text === 'absent' || text === 'refused') return null
  return /^name:[ \t]*["']?([^"'\s#]+)/m.exec(text)?.[1] ?? null
}

export interface AnalyzeOptions {
  /** The Compose file, relative to the directory argument or absolute. Without it the usual names are tried. */
  file?: string
  /**
   * Run without a person watching (the collector): nothing is interpolated, so no variable of the host
   * or of a `.env` ends up in the result, and Compose is given a deadline.
   */
  unattended?: boolean
}

/** What the project declares about itself, or the defaults when it declares
 *  nothing. A malformed file is reported next to the rest of the report rather
 *  than aborting it: knowing the Compose model is still useful while someone
 *  fixes a typo in `project.yaml`. */
function readProjectConfig(root: string): {
  source: 'file' | 'defaults'
  path: string
  config: ProjectConfig | null
  issues: ProjectConfigIssue[]
} {
  const path = join(root, PROJECT_CONFIG_PATH)
  if (!existsSync(path)) {
    return { source: 'defaults', path: PROJECT_CONFIG_PATH, config: defaultProjectConfig(), issues: [] }
  }
  let document: unknown
  try {
    document = parseYaml(readFileSync(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { source: 'file', path: PROJECT_CONFIG_PATH, config: null, issues: [{ path: '', message }] }
  }
  const parsed = parseProjectConfig(document)
  return parsed.ok
    ? { source: 'file', path: PROJECT_CONFIG_PATH, config: parsed.config, issues: [] }
    : { source: 'file', path: PROJECT_CONFIG_PATH, config: null, issues: parsed.issues }
}

/**
 * A small file read through one descriptor: a pipe, a device or anything over `max` bytes is refused, not
 * read. A link is refused unless `followLinks` (a person is watching and Compose would follow it too).
 */
export function readSmallFile(file: string, max: number, followLinks = false): string | 'absent' | 'refused' {
  if (lstatSync(file, { throwIfNoEntry: false }) === undefined) return 'absent'
  let fd: number | undefined
  try {
    const noFollow = followLinks ? 0 : constants.O_NOFOLLOW
    fd = openSync(file, constants.O_RDONLY | noFollow | constants.O_NONBLOCK)
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > max) return 'refused'
    const buffer = Buffer.alloc(info.size)
    let read = 0
    while (read < buffer.length) {
      const count = readSync(fd, buffer, read, buffer.length - read, read)
      if (count === 0) break
      read += count
    }
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return 'refused'
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const ENV_MAX_BYTES = 64 * 1024
function readSmallEnv(file: string, followLinks = false): string | 'absent' | 'refused' {
  return readSmallFile(file, ENV_MAX_BYTES, followLinks)
}
const COMPOSE_MAX_BYTES = 1024 * 1024

export async function analyze(pathValue: string, options: AnalyzeOptions = {}, containers?: ContainerRecord[]) {
  const base = resolve(pathValue)
  let composeFile: string
  if (options.file) {
    composeFile = resolve(base, options.file)
    if (!existsSync(composeFile)) throw new UsageError(`no Compose file at ${composeFile}`)
  } else {
    const candidates = composeCandidates(base)
    if (!candidates[0]) throw new UsageError(`no Compose file found in ${base}`)
    composeFile = candidates[0]
  }
  // The project directory is the file's: that is where Compose reads .env and
  // where the overlay goes, whether the file was named or found.
  const path = dirname(composeFile)
  const unattended = options.unattended === true
  let result = unattended
    ? await runProcess('docker', ['compose', '-f', composeFile, 'config', '--format', 'json', '--no-interpolate'], {
        cwd: path,
        // SIGTERM, which `docker` hands on to the Compose plugin; execa ends it with SIGKILL after five seconds.
        timeout: 20_000,
      })
    : await runProcess('docker', ['compose', '-f', composeFile, 'config', '--format', 'json'], {
        cwd: path,
        reject: false,
      })
  if (!unattended && result.exitCode !== 0)
    result = await runProcess(
      'docker',
      ['compose', '-f', composeFile, 'config', '--format', 'json', '--no-interpolate'],
      { cwd: path },
    )
  const model = ComposeSchema.parse(JSON.parse(result.stdout))
  const overlay =
    ['compose.portta.yaml', 'compose.portta.yml']
      .map((file) => join('.portta', file))
      .find((file) => existsSync(join(path, file))) ??
    ['compose.portta.yaml', 'compose.portta.yml'].find((file) => existsSync(join(path, file))) ??
    null
  // Unattended, a link is not followed; a person watching has Compose follow it, so the read does too.
  const envText = readSmallEnv(join(path, '.env'), !unattended)
  // Compose would read a .env we refuse, and the namespace is its answer: say so rather than guess another.
  if (envText === 'refused')
    throw new UsageError(
      `${join(path, '.env')} is not read: ${unattended ? 'a link, a pipe' : 'a pipe'} or a file over 64 KB`,
    )
  const projectFromEnv =
    envText === 'absent' || envText === 'refused' ? undefined : parseEnv(envText).get('COMPOSE_PROJECT_NAME')
  const gateway = gatewayContext({ required: false })
  let savedProject: string | undefined
  try {
    savedProject = readPlan(gateway.root, safeRealpath(path)).compose.projectName
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
  }
  const declaredName = declaredComposeName(composeFile)
  const project = savedProject || projectFromEnv || model.name || declaredName || composeNamespace(basename(path))
  const services = Object.entries(model.services).map(([name, service]) => ({
    name,
    image: service.image ?? null,
    kind: classifyCompose(service.image ?? '', name),
    container_name: service.container_name ?? null,
    published_ports: publishedPorts(service),
    container_ports: containerPorts(service),
    expose: (service.expose ?? []).map(String),
    networks: Array.isArray(service.networks) ? service.networks : Object.keys(service.networks ?? {}),
    volumes: (service.volumes ?? []).map((volume) =>
      typeof volume === 'string' ? volume.split(':')[0]! : (volume.source ?? volume.target ?? ''),
    ),
    labels: labelsOf(service),
  }))

  // What the host already runs, so a name this project would claim is reported
  // before Compose recreates somebody else's container under it.
  const running = containers ?? (await hostContainers())
  const realPath = safeRealpath(path)
  const workingDirOf = (container: ContainerRecord): string | null =>
    container.labels['com.docker.compose.project.working_dir'] ?? null
  const isThisProject = (container: ContainerRecord): boolean => {
    const dir = workingDirOf(container)
    return container.labels['com.docker.compose.project'] === project && dir !== null && safeRealpath(dir) === realPath
  }
  const container_name_collisions = services.flatMap((service) => {
    if (!service.container_name) return []
    const holder = running.find((container) => container.name === service.container_name)
    if (!holder || isThisProject(holder)) return []
    const owner = holder.labels['com.docker.compose.project']
    return [
      {
        service: service.name,
        container_name: service.container_name,
        used_by: owner ? `Compose project ${owner}` : 'a container outside Compose',
        state: holder.state,
      },
    ]
  })
  const otherDirs = [
    ...new Set(
      running
        .filter((container) => container.labels['com.docker.compose.project'] === project && !isThisProject(container))
        .map(workingDirOf)
        .filter((dir): dir is string => dir !== null),
    ),
  ].sort()

  return {
    path,
    compose_file: basename(composeFile),
    gateway_overlay: overlay,
    project_config: readProjectConfig(path),
    project: {
      name: project,
      source: savedProject
        ? 'Runtime Plan'
        : projectFromEnv
          ? '.env'
          : declaredName
            ? 'compose name:'
            : 'directory name (implicit)',
    },
    domain: gateway.config.domain,
    services,
    findings: {
      published_host_ports: services
        .filter((service) => service.published_ports.length > 0)
        .map((service) => service.name),
      fixed_container_names: services.filter((service) => service.container_name).map((service) => service.name),
      published_datastores: services
        .filter((service) => service.kind === 'datastore' && service.published_ports.length > 0)
        .map((service) => service.name),
      implicit_namespace: !savedProject && !projectFromEnv && !declaredName,
      already_adopted: overlay !== null,
      /** Fixed container names the host already has, and who holds them */
      container_name_collisions,
      /** Containers under this COMPOSE_PROJECT_NAME that run from another directory */
      namespace_in_use: otherDirs.length > 0 ? { project, working_dirs: otherDirs } : null,
      /** A top-level `name:` in the file, but no COMPOSE_PROJECT_NAME in .env: the overlay can only fall back to the written name */
      name_without_env: declaredName !== null && !savedProject && !projectFromEnv ? declaredName : null,
    },
  }
}

export async function analyzeCommand(path: string, options: AnalyzeOptions, command: Command): Promise<void> {
  const containers = await hostContainers()
  const report = await analyze(path, options, containers)
  const output = new Output(globals(command))
  if (output.json) output.data(report)
  else {
    output.line(`Project: ${basename(report.path)}`)
    output.line(`  path                   ${report.path}`)
    output.line(`  compose file           ${report.compose_file}`)
    output.line(`  gateway overlay        ${report.gateway_overlay ?? 'none'}`)
    output.line(`  project namespace      ${report.project.name} (${report.project.source})`)
    const identities = [
      ...new Set(
        report.services.flatMap((service) =>
          Object.entries(service.labels)
            .filter(([key]) => key.startsWith('portta.project'))
            .map(([key, value]) => `${key}=${value}`),
        ),
      ),
    ]
    output.line(
      `  declared identity      ${identities.length ? identities.join(' ') : 'none (inferred from the Compose labels)'}`,
    )
    const declared = report.project_config
    if (declared.issues.length) {
      output.line(`  project.yaml           invalid, so its defaults are not applied:`)
      for (const issue of declared.issues) output.line(`    ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
    } else if (declared.config) {
      const summary = declared.config.name ? `name ${declared.config.name}` : 'declares nothing'
      output.line(`  project.yaml           ${declared.source === 'file' ? summary : `absent, so defaults apply`}`)
    }
    output.line('\nServices')
    for (const service of report.services)
      output.line(
        `  ${service.name}\t${service.image ?? '<built>'}\t${service.kind}\t${service.published_ports.map((port) => `${port.host}:${port.container}`).join(',') || '-'}`,
      )
    output.line('\nFindings')
    if (report.findings.published_host_ports.length) {
      output.line('\n  Published host ports')
      for (const service of report.services)
        for (const port of service.published_ports) {
          const holder = containers.find((container) =>
            container.ports.some((binding) => binding.publicPort === Number(port.host)),
          )
          output.line(
            `    ${service.name}\t${port.host} -> ${port.container}${holder ? `  already held by ${holder.name}` : ''}`,
          )
        }
    } else output.line('\n  No published host ports, so nothing can collide.')
    if (report.findings.fixed_container_names.length) {
      output.line('\n  Fixed container names')
      for (const service of report.services) {
        if (!service.container_name) continue
        const collision = report.findings.container_name_collisions.find((entry) => entry.service === service.name)
        output.line(
          `    ${service.name}\t${service.container_name}${collision ? `  already used by ${collision.used_by} (${collision.state})` : ''}`,
        )
      }
    }
    if (report.findings.published_datastores.length)
      output.line(`\n  Datastores published on the host\n    ${report.findings.published_datastores.join(', ')}`)
    if (report.findings.implicit_namespace)
      output.line('\n  Namespace is implicit\n    COMPOSE_PROJECT_NAME is not set, so Compose uses the directory name')
    if (report.findings.namespace_in_use) {
      output.line(
        `\n  Namespace already in use\n    containers of a Compose project named ${report.findings.namespace_in_use.project} run from ${report.findings.namespace_in_use.working_dirs.join(', ')}`,
      )
      output.line(
        '    starting this directory under the same name would take them over; give one of the two another name: portta namespace',
      )
    }
    if (report.findings.name_without_env) {
      output.line(
        `\n  Project name comes from the Compose file\n    ${report.compose_file} sets name: ${report.findings.name_without_env}, and .env does not define COMPOSE_PROJECT_NAME`,
      )
      output.line(
        `    the overlay writes \${COMPOSE_PROJECT_NAME:-${report.findings.name_without_env}}, so the hostnames follow name: and nothing needs changing;`,
      )
      output.line(
        `    set COMPOSE_PROJECT_NAME=${report.findings.name_without_env} in .env only if you also run \`docker compose -p\` with another name`,
      )
    }
    output.line('\nAdoption plan')
    if (report.gateway_overlay) output.line(`  This project already has ${report.gateway_overlay}.`)
    else
      for (const service of report.services.filter((service) => service.kind === 'http'))
        output.line(
          `  ${service.name}\tport ${service.container_ports[0] ?? service.expose[0] ?? '?'} -> http://${hostLabel({ project: report.project.name, service: service.name })}.${report.domain}`,
        )
    output.line('\nNothing in this project was modified. See docs/product/guides/adopting-projects.md.')
  }
}

async function gitOutput(path: string, args: string[]): Promise<string | null> {
  const result = await runProcess('git', ['-C', path, ...args], { reject: false })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

export async function namespaceCommand(
  options: { path?: string; base?: string; suffix?: string; check?: boolean },
  command: Command,
): Promise<void> {
  const path = resolve(options.path ?? process.cwd())
  const root = await gitOutput(path, ['rev-parse', '--show-toplevel'])
  const branch = await gitOutput(path, ['branch', '--show-current'])
  const base = options.base ?? basename(root ?? path).replace(/-(worktree|wt)$/i, '')
  const suffix = options.suffix ?? (branch && branchSuffix(branch) !== null ? branch : null)
  const namespace = environmentNamespace({ base, branch: suffix, workspace: safeRealpath(path) })
  if (options.check !== false) {
    const members = (await inspectContainers()).filter(
      (container) => container.labels['com.docker.compose.project'] === namespace,
    )
    const foreign = members.some((container) => {
      const owner = container.labels['com.docker.compose.project.working_dir']
      return !owner || safeRealpath(owner) !== safeRealpath(path)
    })
    if (foreign)
      throw new RefusedError(
        `Compose project ${namespace} belongs to another or unknown workspace`,
        'choose another base or suffix; existing containers and volumes are left alone',
      )
    const directory = join(gatewayContext({ required: false }).root, 'runtime/compose')
    let reservedHere = false
    for (const entry of existsSync(directory) ? readdirSync(directory) : []) {
      const plan = join(directory, entry, 'plan.json')
      if (!existsSync(plan)) continue
      const stored = JSON.parse(readFileSync(plan, 'utf8')) as {
        workspace?: string
        compose?: { projectName?: string }
      }
      if (stored.compose?.projectName !== namespace) continue
      if (!stored.workspace || safeRealpath(stored.workspace) !== safeRealpath(path))
        throw new RefusedError(`Compose project ${namespace} is reserved by another runtime plan`)
      reservedHere = true
    }
    if (members.length === 0 && !reservedHere) {
      const volumes = await runProcess(
        'docker',
        ['volume', 'ls', '--filter', `label=com.docker.compose.project=${namespace}`, '--format', '{{.Name}}'],
        { reject: false },
      )
      if (volumes.exitCode !== 0)
        throw new PreconditionError('cannot verify the namespace against existing volumes', volumes.stderr.trim())
      if (volumes.stdout.trim())
        throw new RefusedError(
          `Compose project ${namespace} has volumes without a proven workspace owner`,
          'recover its original runtime plan before reusing the namespace',
        )
    }
  }
  const output = new Output(globals(command))
  if (output.json) output.data({ namespace, base: composeNamespace(base), suffix })
  else output.data(namespace)
}

/** Pure naming output for manual HTTP/TCP overlays, without touching Docker. */
export function hostnameCommand(
  options: { project: string; service: string; context?: string; domain?: string },
  command: Command,
): void {
  const parts = { project: options.project, service: options.service, context: options.context }
  const label = hostLabel(parts)
  const hostname = options.domain ? hostnameFor(parts, options.domain) : null
  const output = new Output(globals(command))
  if (output.json) output.data({ label, hostname })
  else output.data(hostname ?? label)
}

const CONTAINERS_GONE =
  "this project's containers are gone; start them with the runner (PORTTA_RUNNER=true) or docker compose up in the working directory"

export async function projectAction(
  name: string,
  action: 'start' | 'stop' | 'restart',
  command: Command,
): Promise<void> {
  const members = (await inspectContainers()).filter(
    (container) => container.labels['com.docker.compose.project'] === name,
  )
  if (members.length === 0) throw new UsageError(`no project '${name}' is running`, CONTAINERS_GONE)
  const gateway = members.find((container) => container.labels['portta.managed'] === 'true')
  if (gateway) {
    throw new RefusedError(
      `refusing to ${action} ${gateway.name}: it is a Portta component`,
      'gateway components are restarted with portta restart',
    )
  }

  const orderable = members.map((container) => ({
    service: container.labels['com.docker.compose.service'] ?? container.name,
    name: container.name,
    dependsOn: parseDependsOn(container.labels[COMPOSE_DEPENDS_ON]),
    id: container.id,
    state: container.state,
  }))
  const stopOrder = orderProjectServices(orderable, 'stop')
  const startOrder = orderProjectServices(orderable, 'start')
  const steps =
    action === 'restart'
      ? [
          ...stopOrder.map((entry) => ({ ...entry, verb: 'stop' as const })),
          ...startOrder.map((entry) => ({ ...entry, verb: 'start' as const })),
        ]
      : (action === 'stop' ? stopOrder : startOrder).map((entry) => ({ ...entry, verb: action }))

  const output = new Output(globals(command))
  const state = new Map(orderable.map((entry) => [entry.id, entry.state]))
  let failed = 0
  for (const step of steps) {
    const current = state.get(step.id) ?? step.state
    const skip =
      (step.verb === 'start' && current === 'running') ||
      (step.verb === 'stop' && current !== 'running' && current !== 'restarting')
    if (skip) {
      output.progress(`skip     ${step.service} already ${step.verb === 'start' ? 'running' : 'stopped'}`)
      continue
    }
    const result = await runProcess('docker', [step.verb, step.id], { reject: false })
    if (result.failed) {
      failed += 1
      output.warning(`${step.verb} ${step.service}: ${result.stderr.trim() || result.stdout.trim() || 'failed'}`)
      continue
    }
    state.set(step.id, step.verb === 'start' ? 'running' : 'exited')
    output.progress(`ok       ${step.verb} ${step.service}`)
  }
  if (failed > 0)
    throw new RefusedError(`${failed} service(s) failed to ${action}`, 'the rest of the project was still acted on')
}
