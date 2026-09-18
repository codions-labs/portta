import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import {
  branchSuffix,
  COMPOSE_DEPENDS_ON,
  type ContainerRecord,
  composeNamespace,
  defaultProjectConfig,
  orderProjectServices,
  PROJECT_CONFIG_PATH,
  type ProjectConfig,
  type ProjectConfigIssue,
  parseDependsOn,
  parseEnv,
  parseProjectConfig,
  projectsFor,
} from 'portta-core'
import { z } from 'portta-core/zod'
import { parse as parseYaml } from 'yaml'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

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
      routed: container.labels['traefik.enable'] === 'true',
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

/** Known web consoles whose first exposed port is a non-HTTP protocol/API. */
function detectedHttpPort(service: { image: string | null; container_ports: string[]; expose: string[] }): number {
  const image = service.image ?? ''
  if (/mailpit|mailhog/i.test(image)) return 8025
  if (/rustfs|(?:^|\/)minio(?::|\/|$)/i.test(image)) return 9001
  return Number(service.container_ports[0] ?? service.expose[0] ?? 80)
}

function publishedPorts(service: ComposeService): Array<{ host: string; container: string }> {
  return (service.ports ?? []).flatMap((port) => {
    if (typeof port === 'object' && port.published !== undefined)
      return [{ host: String(port.published), container: String(port.target ?? '') }]
    if (typeof port === 'string') {
      const match = /^(?:[^:]+:)?(\d+):(\d+)(?:\/\w+)?$/.exec(port)
      return match ? [{ host: match[1]!, container: match[2]! }] : []
    }
    return []
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
  try {
    const match = /^name:[ \t]*["']?([^"'\s#]+)/m.exec(readFileSync(file, 'utf8'))
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export interface AnalyzeOptions {
  /** The Compose file, relative to the directory argument or absolute. Without it the usual names are tried. */
  file?: string
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

async function analyze(pathValue: string, options: AnalyzeOptions = {}, containers?: ContainerRecord[]) {
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
  let result = await runProcess('docker', ['compose', '-f', composeFile, 'config', '--format', 'json'], {
    cwd: path,
    reject: false,
  })
  if (result.exitCode !== 0)
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
  const projectFromEnv = existsSync(join(path, '.env'))
    ? parseEnv(readFileSync(join(path, '.env'), 'utf8')).get('COMPOSE_PROJECT_NAME')
    : undefined
  const declaredName = declaredComposeName(composeFile)
  const project = projectFromEnv || composeNamespace(declaredName ?? model.name ?? basename(path))
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
      source: projectFromEnv ? '.env' : declaredName ? 'compose name:' : 'directory name (implicit)',
    },
    domain: gatewayContext({ required: false }).config.domain,
    services,
    findings: {
      published_host_ports: services
        .filter((service) => service.published_ports.length > 0)
        .map((service) => service.name),
      fixed_container_names: services.filter((service) => service.container_name).map((service) => service.name),
      published_datastores: services
        .filter((service) => service.kind === 'datastore' && service.published_ports.length > 0)
        .map((service) => service.name),
      implicit_namespace: !projectFromEnv && !declaredName,
      already_adopted: overlay !== null,
      /** Fixed container names the host already has, and who holds them */
      container_name_collisions,
      /** Containers under this COMPOSE_PROJECT_NAME that run from another directory */
      namespace_in_use: otherDirs.length > 0 ? { project, working_dirs: otherDirs } : null,
      /** A top-level `name:` in the file, but no COMPOSE_PROJECT_NAME in .env: the overlay can only fall back to the written name */
      name_without_env: declaredName !== null && !projectFromEnv ? declaredName : null,
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
            .filter(
              ([key]) =>
                key.startsWith('portta.project') || key.startsWith('portta.repo') || key.startsWith('portta.git.root'),
            )
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
      const summary = [
        declared.config.name ? `name ${declared.config.name}` : null,
        declared.config.mainBranch ? `main branch ${declared.config.mainBranch}` : null,
        `worktrees ${declared.config.worktrees.root}`,
        `branches ${declared.config.worktrees.branchPattern}`,
      ].filter((part): part is string => part !== null)
      output.line(
        `  project.yaml           ${declared.source === 'file' ? summary.join(', ') : `absent, so defaults apply: ${summary.join(', ')}`}`,
      )
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
          `  ${service.name}\tport ${service.container_ports[0] ?? service.expose[0] ?? '?'} -> http://${report.project.name}-${service.name}.${report.domain}`,
        )
    output.line('\nNothing in this project was modified. See docs/product/guides/adopting-projects.md.')
  }
}

interface OverlayService {
  name: string
  port?: number
  /** The networks the resolved model already gives the service; `default` when it names none */
  networks: string[]
}

/**
 * The networks a routed service ends up on: the ones it already declares plus
 * `portta`. Writing `default` for a service that names its own networks would
 * make Compose create an unused `<project>_default`.
 */
export function overlayNetworks(declared: readonly string[]): string[] {
  const names = declared.filter((name) => name !== 'portta')
  return [...(names.length > 0 ? names : ['default']), 'portta']
}

export function renderOverlay(
  project: string,
  services: OverlayService[],
  network: string,
  logicalProject?: string,
): string {
  const blocks = services
    .map(({ name, port, networks }) => {
      const ports = '    ports: !reset []\n'
      if (port === undefined) return `  ${name}:\n${ports}`
      return `  ${name}:\n${ports}    networks:\n${overlayNetworks(networks)
        .map((entry) => `      - ${entry}`)
        .join(
          '\n',
        )}\n    labels:\n      - "traefik.enable=true"\n      - "traefik.docker.network=\${PORTTA_NETWORK:-${network}}"${logicalProject ? `\n      - "portta.project=${logicalProject}"` : ''}\n      - "traefik.http.services.\${COMPOSE_PROJECT_NAME:-${project}}-${name}.loadbalancer.server.port=${port}"`
    })
    .join('\n\n')
  return `# ============================================================================\n# Portta runtime overlay — generated, do not edit\n# ============================================================================\n# Source Compose files remain untouched. Portta recreates this file whenever\n# the runtime plan changes. Host ports are removed; routed services keep their\n# private networks and join the Portta gateway network.\n# ============================================================================\n\nservices:\n${blocks}\n\nnetworks:\n  portta:\n    external: true\n    name: \${PORTTA_NETWORK:-${network}}\n`
}

export async function initCommand(
  pathValue: string,
  options: { dryRun?: boolean; service?: string[]; output?: string; force?: boolean; file?: string; project?: string },
  command: Command,
): Promise<void> {
  const report = await analyze(pathValue, { file: options.file }, [])
  const context = gatewayContext({ required: !options.dryRun })
  const requested: OverlayService[] =
    options.service && options.service.length > 0
      ? options.service.map((entry) => {
          const match = /^([a-zA-Z0-9_.-]+):(\d+)$/.exec(entry)
          if (!match) throw new UsageError(`invalid --service value: ${entry}; expected name:port`)
          const service = report.services.find((candidate) => candidate.name === match[1])
          if (!service) throw new UsageError(`no service named ${match[1]} in ${report.compose_file}`)
          return { name: service.name, port: Number(match[2]), networks: service.networks }
        })
      : report.services
          .filter((service) => service.kind === 'http')
          .map((service) => ({ name: service.name, port: detectedHttpPort(service), networks: service.networks }))
  if (!requested.length) throw new RefusedError('no HTTP service was detected', 'pass --service name:port explicitly')
  if (options.project !== undefined && !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(options.project)) {
    throw new UsageError(`invalid --project value: ${options.project}; expected a lowercase Project slug`)
  }
  const routed = new Set(requested.map((service) => service.name))
  const overlayServices: OverlayService[] = report.services
    .filter((service) => routed.has(service.name) || service.published_ports.length > 0)
    .map((service) => ({
      name: service.name,
      port: requested.find((candidate) => candidate.name === service.name)?.port,
      networks: service.networks,
    }))
  const content = renderOverlay(report.project.name, overlayServices, context.config.network, options.project)
  const runtimeId = createHash('sha256').update(safeRealpath(report.path)).digest('hex').slice(0, 16)
  const destination = options.output
    ? resolve(report.path, options.output)
    : join(context.root, 'runtime', 'compose', runtimeId, 'compose.portta.yaml')
  const output = new Output(globals(command))
  if (options.dryRun) {
    output.data(content)
    return
  }
  if (existsSync(destination) && !options.force)
    throw new RefusedError(`${destination} already exists`, 'pass --force to replace it while keeping a backup')
  await confirm(`write ${destination}?`, globals(command).yes === true)
  mkdirSync(dirname(destination), { recursive: true, mode: 0o755 })
  if (existsSync(destination)) renameSync(destination, `${destination}.bak.${Date.now()}`)
  const temporary = `${destination}.${process.pid}.tmp`
  writeFileSync(temporary, content, { mode: 0o644 })
  try {
    const validated = await runProcess(
      'docker',
      ['compose', '-f', join(report.path, report.compose_file), '-f', temporary, 'config', '--format', 'json'],
      { cwd: report.path, reject: false },
    )
    if (validated.exitCode !== 0)
      throw new RefusedError(
        'generated runtime overlay is not valid Compose',
        validated.stderr.trim() || validated.stdout.trim(),
      )
    ComposeSchema.parse(JSON.parse(validated.stdout))
    renameSync(temporary, destination)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  output.progress(`created  ${destination}`)
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
  const suffix = options.suffix ?? (branch ? branchSuffix(branch) : null)
  const namespace = composeNamespace(base, suffix)
  if (options.check !== false) {
    const collision = (await inspectContainers()).some(
      (container) => container.labels['com.docker.compose.project'] === namespace,
    )
    if (collision)
      throw new RefusedError(
        `Compose project ${namespace} is already running`,
        'pass --no-check only when sharing it is intentional',
      )
  }
  const output = new Output(globals(command))
  if (output.json) output.data({ namespace, base: composeNamespace(base), suffix })
  else output.data(namespace)
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
