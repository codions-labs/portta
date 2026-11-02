// `portta agent context`: what an agent starting a session in a directory needs
// to know about a Portta host.
//
// Read-only, offline and fast. It reads the Compose file with `yaml` instead of
// asking Docker to resolve it, never runs `envs analyze` (which runs
// `docker compose config`) and never calls the panel API. The only Docker
// question is bounded by a short timeout, and when Docker does not answer the
// context says what could be learned without it. It always exits 0 and never
// prints a secret: the registry is read for the mode of a hostname, never for
// its credential.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import type { Command } from 'commander'
import {
  type GatewayConfig,
  loadGatewayConfig,
  mergeEnvironment,
  parseEnv,
  protectionForHost,
  readProtectionStore,
} from 'portta-core'
import { parse as parseYaml } from 'yaml'
import { findGatewayRoot, versionForRoot } from '../context.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { CLI_VERSION } from '../version.js'
import { idFor, planPath } from './compose-runtime.js'

export type AgentScope =
  | 'no-portta'
  | 'excluded'
  | 'out-of-scope'
  | 'non-compliant'
  | 'compliant'
  | 'needs-adoption'
  | 'needs-dockerizing'

export type GatewayHealth = 'healthy' | 'unhealthy' | 'down' | 'unknown'

export interface AgentExposure {
  service: string
  host: string
  mode: 'protected' | 'public' | 'undecided'
}

export interface AgentContext {
  host: {
    portta: boolean
    version: string | null
    profile: string | null
    gateway: GatewayHealth | null
    domain: string | null
  }
  project: {
    root: string
    worktree: boolean
    scope: AgentScope
    compose: string | null
    publishedPorts: string[]
    exposure: AgentExposure[]
    urls: string[]
    violations: string[]
    note: string | null
  }
  skills: string[]
  next: string
}

/** The Docker probes are bounded: a daemon that hangs must not hold a session start. */
const DOCKER_TIMEOUT_MS = 800
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
const HOOK_MAX_LINES = 15
const MAX_FILE_BYTES = 1_000_000

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean }
}

function readSmall(path: string): string | null {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The directories the user keeps Portta out of, from `~/.config/portta/agents/scope.yaml`. */
export function excludedPaths(home: string): string[] {
  const text = readSmall(join(home, '.config', 'portta', 'agents', 'scope.yaml'))
  if (text === null) return []
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { exclude?: unknown }).exclude)
      ? (parsed as { exclude: unknown[] }).exclude
      : []
  return list
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .map((entry) => (entry === '~' ? home : entry.startsWith('~/') ? join(home, entry.slice(2)) : resolve(entry)))
}

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
}

function realOr(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function isExcluded(paths: string[], home: string, directories: string[]): boolean {
  const candidates = directories.flatMap((directory) => [directory, realOr(directory)])
  return excludedPaths(home).some((excluded) =>
    [excluded, realOr(excluded)].some((root) => candidates.some((candidate) => inside(candidate, root))),
  ) && paths.length >= 0
}

interface Discovery {
  /** The directory a Runtime Plan would be keyed by, or the Git root when there is no Compose file. */
  root: string | null
  composeDirectory: string | null
  composeFile: string | null
  worktree: boolean
}

/** Walks up from `start` to the nearest Compose file and Git marker, never reaching `$HOME` or above. */
export function discoverProject(start: string, home: string): Discovery {
  let composeDirectory: string | null = null
  let composeFile: string | null = null
  let gitDirectory: string | null = null
  for (let current = start; current !== home && current !== dirname(current); current = dirname(current)) {
    if (!composeDirectory) {
      const file = COMPOSE_FILES.find((name) => existsSync(join(current, name)))
      if (file) {
        composeDirectory = current
        composeFile = file
      }
    }
    if (!gitDirectory && existsSync(join(current, '.git'))) gitDirectory = current
    if (composeDirectory && gitDirectory) break
  }
  let worktree = false
  if (gitDirectory) {
    const text = readSmall(join(gitDirectory, '.git'))
    // A worktree's `.git` is a file that points into the main repository's
    // `worktrees` directory. A submodule's is a file too, and is not one.
    worktree = text !== null && /^gitdir:.*[\\/]worktrees[\\/]/m.test(text)
  }
  return { root: composeDirectory ?? gitDirectory, composeDirectory, composeFile, worktree }
}

/** `<ip>:<published>-><target>/<protocol>`, whichever Compose spelling declared it. */
export function publishedPortsOf(model: unknown): string[] {
  const services = (model as { services?: Record<string, { ports?: unknown[] }> } | null)?.services
  if (!services || typeof services !== 'object') return []
  const found: string[] = []
  for (const service of Object.values(services)) {
    for (const port of Array.isArray(service?.ports) ? service.ports : []) {
      if (typeof port === 'number') found.push(`0.0.0.0:?->${port}/tcp`)
      else if (typeof port === 'string') found.push(normalizeShortPort(port))
      else if (port && typeof port === 'object') {
        const long = port as { target?: unknown; published?: unknown; host_ip?: unknown; protocol?: unknown }
        const published = long.published === undefined ? '?' : String(long.published)
        found.push(`${String(long.host_ip ?? '0.0.0.0')}:${published}->${String(long.target ?? '?')}/${String(long.protocol ?? 'tcp')}`)
      }
    }
  }
  return [...new Set(found)]
}

function normalizeShortPort(value: string): string {
  const [spec = '', protocol = 'tcp'] = value.split('/')
  const parts = spec.split(':')
  if (parts.length === 1) return `0.0.0.0:?->${parts[0]}/${protocol}`
  if (parts.length === 2) return `0.0.0.0:${parts[0]}->${parts[1]}/${protocol}`
  return `${parts[0]}:${parts[1]}->${parts.slice(2).join(':')}/${protocol}`
}

function readCompose(directory: string, file: string): unknown {
  const text = readSmall(join(directory, file))
  if (text === null) return null
  try {
    return parseYaml(text)
  } catch {
    return null
  }
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

interface PlanFacts {
  workspace: string
  profile: string
  projectName: string
  generatedOverlay: string
  inputs: Array<{ path: string; digest: string }>
  manifest: { local: { path: string; digest: string | null }; stored: { path: string; digest: string | null } } | null
  hasCapabilities: boolean
  services: Array<{ name: string; route: string; host: string | null }>
}

function readPlan(gatewayRoot: string, workspace: string): PlanFacts | null {
  const text = readSmall(planPath(gatewayRoot, idFor(workspace)))
  if (text === null) return null
  try {
    const plan = JSON.parse(text) as Record<string, any>
    return {
      workspace: String(plan.workspace ?? workspace),
      profile: String(plan.profile ?? ''),
      projectName: String(plan.compose?.projectName ?? ''),
      generatedOverlay: String(plan.compose?.generatedOverlay ?? ''),
      inputs: Array.isArray(plan.inputs) ? plan.inputs : [],
      manifest: plan.manifest ?? null,
      hasCapabilities: 'capabilities' in plan,
      services: Array.isArray(plan.services) ? plan.services : [],
    }
  } catch {
    return null
  }
}

function digestIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? digest(path) : null
  } catch {
    return null
  }
}

/** What makes a persisted plan stale without asking Docker: the same inputs `runtime up` compares, minus the Compose version. */
function staleReasons(plan: PlanFacts, profile: string | null): string[] {
  if (!plan.manifest || !plan.hasCapabilities) return ['the plan predates manifest tracking']
  const reasons: string[] = []
  if (!existsSync(plan.generatedOverlay)) reasons.push('the generated overlay is missing')
  if (profile && plan.profile !== profile) reasons.push(`the plan was made for profile ${plan.profile}`)
  if (plan.inputs.some((input) => !existsSync(input.path) || digestIfPresent(input.path) !== input.digest))
    reasons.push('Compose inputs changed since the plan')
  if (
    digestIfPresent(plan.manifest.local.path) !== plan.manifest.local.digest ||
    digestIfPresent(plan.manifest.stored.path) !== plan.manifest.stored.digest
  )
    reasons.push('the runtime manifest changed since the plan')
  return reasons
}

function webService(directory: string): boolean {
  const manifest = readSmall(join(directory, 'package.json'))
  if (manifest !== null) {
    try {
      const scripts = (JSON.parse(manifest) as { scripts?: Record<string, unknown> }).scripts
      if (scripts && (typeof scripts.dev === 'string' || typeof scripts.start === 'string')) return true
    } catch {}
  }
  if (existsSync(join(directory, 'artisan')) || existsSync(join(directory, 'manage.py'))) return true
  const gemfile = readSmall(join(directory, 'Gemfile'))
  if (gemfile !== null && /\brails\b/i.test(gemfile)) return true
  const goMod = readSmall(join(directory, 'go.mod'))
  if (goMod !== null) {
    if (/net\/http|gin-gonic|labstack\/echo|gofiber|go-chi|gorilla\/mux/.test(goMod)) return true
    try {
      for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.go')).slice(0, 20))
        if (readSmall(join(directory, name))?.includes('"net/http"')) return true
    } catch {}
  }
  return false
}

function needsDockerizing(directory: string): boolean {
  return existsSync(join(directory, 'Dockerfile')) || webService(directory)
}

async function probeGateway(): Promise<GatewayHealth> {
  const result = await runProcess(
    'docker',
    ['ps', '--filter', 'label=portta.managed=true', '--format', '{{.Label "portta.component"}}\t{{.Status}}'],
    { reject: false, timeout: DOCKER_TIMEOUT_MS },
  )
  if (result.exitCode !== 0 || result.error) return 'unknown'
  const rows = result.stdout.split('\n').filter(Boolean)
  if (!rows.some((row) => row.startsWith('traefik\t'))) return 'down'
  return rows.some((row) => /unhealthy|restarting/i.test(row)) ? 'unhealthy' : 'healthy'
}

/** Host bindings a running container of this Compose project publishes. IPv6 duplicates are dropped. */
async function probeRunningPorts(projectName: string): Promise<string[] | null> {
  if (!projectName) return null
  const result = await runProcess(
    'docker',
    ['ps', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Ports}}'],
    { reject: false, timeout: DOCKER_TIMEOUT_MS },
  )
  if (result.exitCode !== 0 || result.error) return null
  const found = result.stdout
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes('->') && !entry.startsWith(':::') && !entry.startsWith('[::]'))
  return [...new Set(found)]
}

function hostConfig(root: string): { config: GatewayConfig | null; version: string | null } {
  let version: string | null = null
  try {
    version = versionForRoot(root)
  } catch {}
  try {
    const envFile = join(root, '.env')
    const file = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : new Map<string, string>()
    return { config: loadGatewayConfig(mergeEnvironment(file, process.env)), version }
  } catch {
    return { config: null, version }
  }
}

const SKILLS: Record<AgentScope, string[]> = {
  'no-portta': [],
  excluded: [],
  'out-of-scope': ['portta-host-context'],
  'non-compliant': ['portta-host-context', 'portta-adopt-compose'],
  compliant: ['portta-host-context'],
  'needs-adoption': ['portta-adopt-compose'],
  'needs-dockerizing': ['portta-dockerize'],
}

export interface ContextOptions {
  /** The directory the session starts in. Defaults to the current one. */
  path?: string
  /** The home directory; defaults to `$HOME`. */
  home?: string
  /** The installation to read; defaults to the one this host has. `null` means there is none. */
  root?: string | null
}

export async function agentContext(options: ContextOptions = {}): Promise<AgentContext> {
  const start = resolve(options.path ?? process.cwd())
  const home = resolve(options.home ?? process.env.HOME ?? homedir())
  const root = options.root !== undefined ? options.root : findGatewayRoot(start)

  const empty = (scope: AgentScope, next: string, rest: Partial<AgentContext['project']> = {}): AgentContext => ({
    host: { portta: false, version: CLI_VERSION, profile: null, gateway: null, domain: null },
    project: {
      root: start,
      worktree: false,
      scope,
      compose: null,
      publishedPorts: [],
      exposure: [],
      urls: [],
      violations: [],
      note: null,
      ...rest,
    },
    skills: SKILLS[scope],
    next,
  })
  if (!root) return empty('no-portta', 'This is not a Portta host: nothing applies.')

  const gateway = probeGateway()
  const { config, version } = hostConfig(root)
  const host = (health: GatewayHealth): AgentContext['host'] => ({
    portta: true,
    version,
    profile: config?.profile ?? null,
    gateway: health,
    domain: config?.domain ?? null,
  })
  const finish = async (
    scope: AgentScope,
    next: string,
    project: Partial<AgentContext['project']>,
    health?: GatewayHealth,
  ): Promise<AgentContext> => {
    const base = empty(scope, next, project)
    return { ...base, host: host(health ?? (await gateway)) }
  }

  const found = discoverProject(start, home)
  if (isExcluded([], home, [start, ...(found.root ? [found.root] : [])]))
    return finish('excluded', 'This directory is excluded in scope.yaml: nothing to do for Portta here.', {}, 'unknown')
  if (start === home)
    return finish('out-of-scope', 'No action needed here: this is the home directory.', {
      note: 'the home directory is never a project',
    })
  if (!found.root)
    return finish('out-of-scope', 'No action needed: this folder has no Git repository and no Compose file.', {
      note: 'no Git repository and no Compose file',
    })

  const worktree = found.worktree
  const projectRoot = found.root
  const common = { root: projectRoot, worktree }
  const worktreeHint = worktree ? ' This is a Git worktree: run portta envs namespace so it gets its own URL.' : ''

  if (found.composeDirectory && found.composeFile) {
    const directory = found.composeDirectory
    const file = found.composeFile
    const plan = readPlan(root, directory)
    if (!plan) {
      const ports = publishedPortsOf(readCompose(directory, file))
      return finish(
        'needs-adoption',
        `Run portta adopt --dry-run --json and follow the portta-adopt-compose skill.${worktreeHint}`,
        { ...common, root: directory, compose: file, publishedPorts: ports },
      )
    }
    const violations: string[] = []
    const reasons = staleReasons(plan, config?.profile ?? null)
    if (reasons.length) violations.push(`stale plan: ${reasons.join('; ')}`)
    const running = await probeRunningPorts(plan.projectName)
    if (running?.length) violations.push(`published host ports: ${running.join(', ')}`)

    const routed = plan.services.filter((service) => service.route === 'http' && service.host)
    const publicHost = config?.profile === 'remote-public'
    let registry: ReturnType<typeof readProtectionStore> | null = null
    try {
      registry = readProtectionStore(join(root, 'state/auth/protections.json'))
    } catch {
      if (publicHost) violations.push('the exposure registry could not be read')
    }
    const exposure: AgentExposure[] = []
    for (const service of routed) {
      const record = registry && service.host ? protectionForHost(registry, service.host) : null
      if (record) exposure.push({ service: service.name, host: service.host!, mode: record.mode })
      else if (publicHost && registry) {
        exposure.push({ service: service.name, host: service.host!, mode: 'undecided' })
        violations.push(`${service.name} has no exposure decision (portta adopt --protect or --public)`)
      }
    }
    const scheme = config?.tlsEnabled ? 'https' : 'http'
    const urls = routed.map((service) => `${scheme}://${service.host}`)
    const scope: AgentScope = violations.length ? 'non-compliant' : 'compliant'
    return finish(
      scope,
      scope === 'compliant'
        ? `Start with portta runtime up and report URLs from portta urls.${worktreeHint}`
        : `Fix: ${violations.join('; ')}. Run portta adopt --dry-run --json and follow the portta-adopt-compose skill.${worktreeHint}`,
      { ...common, root: directory, compose: file, publishedPorts: running ?? [], exposure, urls, violations },
    )
  }

  if (needsDockerizing(projectRoot))
    return finish(
      'needs-dockerizing',
      `Ask before writing any file, then follow the portta-dockerize skill.${worktreeHint}`,
      common,
    )
  return finish(
    'out-of-scope',
    'No action needed: nothing here looks like a web service.',
    { ...common, note: 'no Dockerfile or web service found' },
  )
}

/** Text for the agent's context: at most 15 lines, English, nothing on a host without Portta. */
export function renderHook(context: AgentContext): string {
  if (context.project.scope === 'no-portta') return ''
  const version = context.host.version ?? 'unknown version'
  const prefix = `Portta host ${version}.`
  const project = context.project
  const lines: string[] = []
  const worktree = project.worktree ? ['This is a Git worktree: run `portta envs namespace` so it gets its own URL.'] : []
  switch (project.scope) {
    case 'excluded':
      lines.push(`${prefix} This directory is excluded in scope.yaml (scope: excluded), no action needed.`)
      break
    case 'out-of-scope':
      lines.push(
        `${prefix} This project exposes no web service (scope: out-of-scope), no action needed.`,
        'If you start containers here, publish no ports and follow the portta-host-context skill.',
        ...(project.note ? [`Note: ${project.note}.`] : []),
      )
      break
    case 'compliant':
      lines.push(
        `${prefix} Profile ${context.host.profile ?? 'unknown'}, gateway ${context.host.gateway ?? 'unknown'}. This project is on Portta (scope: compliant).`,
        ...(project.urls.length ? ['Report these URLs, never localhost:', ...project.urls.slice(0, 5).map((url) => `  ${url}`)] : []),
        'Start with `portta runtime up`. Publish no ports and follow the portta-host-context skill.',
        ...worktree,
      )
      break
    case 'non-compliant':
      lines.push(
        `${prefix} This project is adopted but not compliant (scope: non-compliant):`,
        ...project.violations.slice(0, 5).map((violation) => `  - ${violation}`),
        'Run `portta adopt --dry-run --json` and follow the portta-adopt-compose skill. Ask before deciding anything pending.',
        ...worktree,
      )
      break
    case 'needs-adoption':
      lines.push(
        `${prefix} This project has a Compose file (${project.compose}) and no Runtime Plan (scope: needs-adoption).`,
        ...(project.publishedPorts.length ? [`It publishes host ports: ${project.publishedPorts.slice(0, 4).join(', ')}.`] : []),
        'Run `portta adopt --dry-run --json` and follow the portta-adopt-compose skill. Ask before deciding anything pending.',
        'Never publish a port, and never free one by force.',
        ...worktree,
      )
      break
    case 'needs-dockerizing':
      lines.push(
        `${prefix} This project looks like a web service with no Compose file (scope: needs-dockerizing).`,
        'If it needs a URL, follow the portta-dockerize skill. Ask before writing any file, and publish no ports.',
        ...worktree,
      )
      break
  }
  return lines.slice(0, HOOK_MAX_LINES).join('\n')
}

function renderText(context: AgentContext): string {
  const hook = renderHook(context)
  return hook === '' ? 'This is not a Portta host: nothing applies.' : hook
}

/** Never throws and never sets a failing exit code: an agent session must not break on this. */
export async function agentContextCommand(
  options: { path?: string; home?: string; format?: string },
  command: Command,
): Promise<void> {
  let context: AgentContext
  try {
    context = await agentContext({ path: options.path, home: options.home })
  } catch {
    const root = resolve(options.path ?? process.cwd())
    context = {
      host: { portta: true, version: null, profile: null, gateway: 'unknown', domain: null },
      project: {
        root,
        worktree: false,
        scope: 'out-of-scope',
        compose: null,
        publishedPorts: [],
        exposure: [],
        urls: [],
        violations: [],
        note: 'the host state could not be read',
      },
      skills: SKILLS['out-of-scope'],
      next: 'No action needed: the host state could not be read.',
    }
  }
  const output = new Output(globals(command))
  if (output.json) return output.data(context)
  const text = options.format === 'hook' ? renderHook(context) : renderText(context)
  if (text !== '') process.stdout.write(`${text}\n`)
}
