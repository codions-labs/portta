import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  AcpProviderConfig,
  AgentId,
  AgentKind,
  AutoNameConfig,
  AutoPullConfig,
  CustomAgentConfig,
  GitHubIntegrationConfig,
  LifecycleHooksConfig,
  LinearIntegrationConfig,
  LinkedRepoConfig,
  MountSpec,
  MultiplexerKind,
  OneshotConfig,
  PaneTemplate,
  ProfileConfig,
  ProjectConfig,
  RuntimeSelection,
  ServiceSpec,
} from 'portta-core/taskflow'
import { APP_DEFAULTS, APP_NAME } from 'portta-core/taskflow/config'
import { projectPaths } from 'portta-core/taskflow/paths'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { isRecord } from '../lib/type-guards.ts'

export type {
  AcpProviderConfig,
  CustomAgentConfig,
  LinkedRepoConfig,
  MountSpec,
  PaneTemplate,
  ProfileConfig,
  ProjectConfig,
}
export type ServiceConfig = ServiceSpec
export type DockerProfileConfig = ProfileConfig & { runtime: 'docker'; image: string }

interface LoadConfigOptions {
  resolvedRoot?: boolean
}

interface LocalProjectConfigOverlay {
  multiplexer: MultiplexerKind | null
  worktreeRoot: string | null
  profiles: Record<string, ProfileConfig>
  agents: Record<AgentId, CustomAgentConfig>
  providers: Record<string, AcpProviderConfig>
  lifecycleHooks: LifecycleHooksConfig
  linear: Partial<LinearIntegrationConfig> | null
  github: Partial<GitHubIntegrationConfig> | null
  autoPull: Partial<AutoPullConfig> | null
}

function parseWorktreeRoot(raw: unknown, fallback: string): string {
  if (!isRecord(raw)) return fallback
  if (isRecord(raw.worktrees) && typeof raw.worktrees.root === 'string' && raw.worktrees.root.trim()) {
    return raw.worktrees.root.trim()
  }
  return fallback
}

function parseExposure(raw: unknown): ProjectConfig['exposure'] {
  const local = isRecord(raw) && isRecord(raw.local) ? raw.local : {}
  return {
    local: {
      provider: local.provider === 'disabled' ? 'disabled' : 'loopback',
      autoExpose:
        local.autoExpose === 'manual' || local.autoExpose === 'http' || local.autoExpose === 'all'
          ? local.autoExpose
          : 'all',
    },
  }
}

/** Parse a `multiplexer:` value. Returns null when absent or unrecognized, so a
 *  local overlay only overrides when it actually names one. */
function parseMultiplexer(value: unknown): MultiplexerKind | null {
  if (value === 'herdr') return 'herdr'
  if (value === 'tmux') return 'tmux'
  return null
}

const DEFAULT_PANES: PaneTemplate[] = [
  { id: 'agent', kind: 'agent', focus: true },
  { id: 'runtime', kind: 'runtime', split: 'right', sizePct: 30, cwd: 'worktree' },
]

function DEFAULT_ONESHOT_SYSTEM_PROMPT(): string {
  return [
    `You are running in ${APP_NAME} ONESHOT mode. There is NO interactive user — nobody is watching the chat or will respond to questions, approvals, or status checks. Any message asking the user to review, approve, confirm, take a look, or 'let you know' is wasted output: it will not be answered.`,
    'Your job is to take the task to its real conclusion without pausing:',
    '1) Make the change. 2) Validate it (run the relevant tests, typecheck, build, or quick manual check). 3) Commit. 4) Push. 5) Open a pull request. Only then are you done.',
    "When something is ambiguous, pick the most reasonable default and proceed. When you would normally ask 'should I X or Y?', just pick one and continue — note the choice in the PR description if it matters.",
    "Never end your turn with a question, a suggestion to 'take a look', or a request for approval. Stop only when the PR is open, or when you hit a technical error you cannot recover from yourself (in which case clearly state the blocker).",
  ].join(' ')
}

const DEFAULT_PROFILE: ProfileConfig = {
  runtime: 'host',
  environment: { provider: 'auto' },
  envPassthrough: [],
  panes: clonePanes(DEFAULT_PANES),
}

const DEFAULT_CONFIG: ProjectConfig = {
  name: APP_DEFAULTS.projectName,
  multiplexer: APP_DEFAULTS.multiplexer,
  workspace: {
    mainBranch: APP_DEFAULTS.mainBranch,
    worktreeRoot: APP_DEFAULTS.worktreeRoot,
    worktrees: { root: APP_DEFAULTS.worktreeRoot },
    defaultAgent: APP_DEFAULTS.defaultAgent,
    autoPull: { enabled: false, intervalSeconds: 300 },
  },
  profiles: { default: DEFAULT_PROFILE },
  exposure: { local: { provider: 'loopback', autoExpose: 'all' } },
  agents: {},
  providers: {},
  services: [],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
  },
  lifecycleHooks: {},
  autoName: null,
  oneshot: { systemPrompt: DEFAULT_ONESHOT_SYSTEM_PROMPT() },
}

function clonePanes(panes: PaneTemplate[]): PaneTemplate[] {
  return panes.map((pane) => ({ ...pane }))
}

function cloneMounts(mounts: MountSpec[] | undefined): MountSpec[] | undefined {
  return mounts?.map((mount) => ({ ...mount }))
}

function cloneProfile(profile: ProfileConfig): ProfileConfig {
  return {
    ...profile,
    envPassthrough: [...profile.envPassthrough],
    panes: clonePanes(profile.panes),
    ...(profile.mounts ? { mounts: cloneMounts(profile.mounts) } : {}),
    ...(profile.environment ? { environment: { ...profile.environment } } : {}),
  }
}

function cloneProfiles(profiles: Record<string, ProfileConfig>): Record<string, ProfileConfig> {
  return Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, cloneProfile(profile)]))
}

function defaultProfiles(): Record<string, ProfileConfig> {
  return { default: cloneProfile(DEFAULT_PROFILE) }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function parseAgentKind(value: unknown): AgentKind {
  return value === 'codex' ? 'codex' : 'claude'
}

function parsePanes(raw: unknown): PaneTemplate[] {
  if (!Array.isArray(raw)) return clonePanes(DEFAULT_PANES)

  const panes = raw.map((entry, index) => parsePane(entry, index)).filter((pane): pane is PaneTemplate => pane !== null)

  return panes.length > 0 ? panes : clonePanes(DEFAULT_PANES)
}

function parsePane(raw: unknown, index: number): PaneTemplate | null {
  if (!isRecord(raw)) return null
  if (raw.kind !== 'agent' && raw.kind !== 'shell' && raw.kind !== 'command' && raw.kind !== 'runtime') return null

  const pane: PaneTemplate = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `pane-${index + 1}`,
    kind: raw.kind,
  }

  if (raw.split === 'right' || raw.split === 'bottom') pane.split = raw.split
  if (typeof raw.sizePct === 'number' && Number.isFinite(raw.sizePct)) pane.sizePct = raw.sizePct
  if (raw.focus === true) pane.focus = true
  if (raw.cwd === 'repo' || raw.cwd === 'worktree') pane.cwd = raw.cwd

  if (raw.kind === 'command') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) return null
    pane.command = raw.command.trim()
    if (typeof raw.workingDir === 'string' && raw.workingDir.trim()) {
      pane.workingDir = raw.workingDir.trim()
    }
  }

  return pane
}

function parseMounts(raw: unknown): MountSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const mounts = raw
    .filter(isRecord)
    .filter((entry) => typeof entry.hostPath === 'string' && entry.hostPath.length > 0)
    .map((entry) => ({
      hostPath: entry.hostPath as string,
      ...(typeof entry.guestPath === 'string' && entry.guestPath.length > 0 ? { guestPath: entry.guestPath } : {}),
      ...(typeof entry.writable === 'boolean' ? { writable: entry.writable } : {}),
    }))

  return mounts.length > 0 ? mounts : undefined
}

function parseProfile(raw: unknown, fallbackRuntime: 'host' | 'docker'): ProfileConfig {
  if (!isRecord(raw)) {
    return {
      runtime: fallbackRuntime,
      envPassthrough: [],
      panes: clonePanes(DEFAULT_PANES),
    }
  }

  const runtime = raw.runtime === 'docker' ? 'docker' : fallbackRuntime
  const envPassthrough = isStringArray(raw.envPassthrough) ? raw.envPassthrough : []
  const panes = parsePanes(raw.panes)
  const mounts = parseMounts(raw.mounts)
  const image = typeof raw.image === 'string' && raw.image.trim() ? raw.image.trim() : undefined
  const selectedProvider: RuntimeSelection | undefined =
    isRecord(raw.environment) &&
    (raw.environment.provider === 'auto' ||
      raw.environment.provider === 'host' ||
      raw.environment.provider === 'docker' ||
      raw.environment.provider === 'compose' ||
      raw.environment.provider === 'devcontainer' ||
      raw.environment.provider === 'dockerfile')
      ? raw.environment.provider
      : undefined
  const environment = isRecord(raw.environment)
    ? {
        ...(selectedProvider ? { provider: selectedProvider } : {}),
        ...(typeof raw.environment.config === 'string' && raw.environment.config.trim()
          ? { config: raw.environment.config.trim() }
          : {}),
        ...(typeof raw.environment.agentService === 'string' && raw.environment.agentService.trim()
          ? { agentService: raw.environment.agentService.trim() }
          : {}),
        ...(typeof raw.environment.command === 'string' && raw.environment.command.trim()
          ? { command: raw.environment.command.trim() }
          : {}),
        ...(typeof raw.environment.cwd === 'string' && raw.environment.cwd.trim()
          ? { cwd: raw.environment.cwd.trim() }
          : {}),
        ...(typeof raw.environment.stopCommand === 'string' && raw.environment.stopCommand.trim()
          ? { stopCommand: raw.environment.stopCommand.trim() }
          : {}),
      }
    : undefined

  return {
    runtime,
    envPassthrough,
    ...(raw.yolo === true ? { yolo: true } : {}),
    panes,
    ...(typeof raw.systemPrompt === 'string' && raw.systemPrompt.length > 0 ? { systemPrompt: raw.systemPrompt } : {}),
    ...(image ? { image } : {}),
    ...(mounts ? { mounts } : {}),
    ...(environment && Object.keys(environment).length > 0 ? { environment } : {}),
  }
}

function parseProfiles(raw: unknown, includeDefaultProfile: boolean): Record<string, ProfileConfig> {
  if (!isRecord(raw)) return includeDefaultProfile ? defaultProfiles() : {}

  const profiles = Object.entries(raw).reduce<Record<string, ProfileConfig>>((acc, [name, value]) => {
    const fallbackRuntime = name === 'sandbox' ? 'docker' : 'host'
    acc[name] = parseProfile(value, fallbackRuntime)
    return acc
  }, {})

  if (Object.keys(profiles).length === 0) {
    return includeDefaultProfile ? defaultProfiles() : {}
  }

  return profiles
}

function cloneAgentConfig(agent: CustomAgentConfig): CustomAgentConfig {
  return { ...agent }
}

function cloneAgents(agents: Record<AgentId, CustomAgentConfig>): Record<AgentId, CustomAgentConfig> {
  return Object.fromEntries(Object.entries(agents).map(([id, agent]) => [id, cloneAgentConfig(agent)]))
}

function parseCustomAgent(raw: unknown): CustomAgentConfig | null {
  if (!isRecord(raw)) return null
  if (typeof raw.label !== 'string' || !raw.label.trim()) return null
  if (typeof raw.startCommand !== 'string' || !raw.startCommand.trim()) return null

  return {
    label: raw.label.trim(),
    startCommand: raw.startCommand.trim(),
    ...(typeof raw.resumeCommand === 'string' && raw.resumeCommand.trim()
      ? { resumeCommand: raw.resumeCommand.trim() }
      : {}),
  }
}

function parseCustomAgents(raw: unknown): Record<AgentId, CustomAgentConfig> {
  if (!isRecord(raw)) return {}

  return Object.entries(raw).reduce<Record<AgentId, CustomAgentConfig>>((acc, [id, value]) => {
    if (!id.trim()) return acc
    const parsed = parseCustomAgent(value)
    if (parsed) {
      acc[id.trim()] = parsed
    }
    return acc
  }, {})
}

function cloneAcpProviders(providers: Record<string, AcpProviderConfig>): Record<string, AcpProviderConfig> {
  return Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => [id, { ...provider, args: [...provider.args] }]),
  )
}

/** One `providers:` entry. `command` is required; `args` keeps only strings; `label` falls back to the id. */
function parseAcpProvider(id: string, raw: unknown): AcpProviderConfig | null {
  if (!isRecord(raw)) return null
  if (typeof raw.command !== 'string' || !raw.command.trim()) return null

  return {
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id,
    command: raw.command.trim(),
    args: Array.isArray(raw.args) ? raw.args.filter((entry): entry is string => typeof entry === 'string') : [],
  }
}

function parseAcpProviders(raw: unknown): Record<string, AcpProviderConfig> {
  if (!isRecord(raw)) return {}

  return Object.entries(raw).reduce<Record<string, AcpProviderConfig>>((acc, [id, value]) => {
    const key = id.trim()
    if (!key) return acc
    const parsed = parseAcpProvider(key, value)
    if (parsed) {
      acc[key] = parsed
    }
    return acc
  }, {})
}

function parseServices(raw: unknown): ServiceSpec[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter(isRecord)
    .filter((entry) => typeof entry.name === 'string' && typeof entry.portEnv === 'string')
    .map((entry) => ({
      name: entry.name as string,
      portEnv: entry.portEnv as string,
      ...(typeof entry.portStart === 'number' && Number.isFinite(entry.portStart)
        ? { portStart: entry.portStart }
        : {}),
      ...(typeof entry.portStep === 'number' && Number.isFinite(entry.portStep) ? { portStep: entry.portStep } : {}),
      ...(typeof entry.urlTemplate === 'string' && entry.urlTemplate.length > 0
        ? { urlTemplate: entry.urlTemplate }
        : {}),
      ...(entry.protocol === 'http' ||
      entry.protocol === 'https' ||
      entry.protocol === 'tcp' ||
      entry.protocol === 'udp'
        ? { protocol: entry.protocol }
        : {}),
    }))
}

function parseStartupEnvs(raw: unknown): Record<string, string | boolean> {
  if (!isRecord(raw)) return {}

  const startupEnvs: Record<string, string | boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      startupEnvs[key] = value
    } else {
      startupEnvs[key] = typeof value === 'string' ? value : String(value)
    }
  }
  return startupEnvs
}

function parseLifecycleHooks(raw: unknown): LifecycleHooksConfig {
  if (!isRecord(raw)) return {}

  const hooks: LifecycleHooksConfig = {}
  if (typeof raw.postCreate === 'string' && raw.postCreate.trim()) {
    hooks.postCreate = raw.postCreate.trim()
  }
  if (typeof raw.preRemove === 'string' && raw.preRemove.trim()) {
    hooks.preRemove = raw.preRemove.trim()
  }
  return hooks
}

function parseOneshot(raw: unknown): OneshotConfig {
  if (!isRecord(raw)) return { systemPrompt: DEFAULT_ONESHOT_SYSTEM_PROMPT() }
  const systemPrompt =
    typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()
      ? raw.systemPrompt.trim()
      : DEFAULT_ONESHOT_SYSTEM_PROMPT()
  return { systemPrompt }
}

function parseAutoName(raw: unknown): AutoNameConfig | null {
  if (!isRecord(raw)) return null
  const provider = raw.provider
  if (provider !== 'claude' && provider !== 'codex') return null

  return {
    provider,
    ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(typeof raw.system_prompt === 'string' && raw.system_prompt.trim()
      ? { systemPrompt: raw.system_prompt.trim() }
      : {}),
  }
}

function parseAutoPull(raw: unknown): AutoPullConfig {
  if (!isRecord(raw)) return DEFAULT_CONFIG.workspace.autoPull
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : false
  const interval =
    typeof raw.intervalSeconds === 'number' && Number.isFinite(raw.intervalSeconds) && raw.intervalSeconds >= 30
      ? raw.intervalSeconds
      : 300
  return { enabled, intervalSeconds: interval }
}

function parseLinkedRepos(raw: unknown): LinkedRepoConfig[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter(isRecord)
    .filter((entry) => typeof entry.repo === 'string')
    .map((entry) => ({
      repo: entry.repo as string,
      alias: typeof entry.alias === 'string' ? entry.alias : ((entry.repo as string).split('/').pop() ?? 'repo'),
      ...(typeof entry.dir === 'string' && entry.dir.trim() ? { dir: entry.dir.trim() } : {}),
    }))
}

export function isDockerProfile(profile: ProfileConfig | undefined): profile is DockerProfileConfig {
  return !!profile && profile.runtime === 'docker' && typeof profile.image === 'string' && profile.image.length > 0
}

export function getDefaultProfileName(config: ProjectConfig): string {
  if (config.profiles.default) return 'default'
  return Object.keys(config.profiles)[0] ?? 'default'
}

function readConfigFile(root: string): string {
  return readFileSync(projectPaths(root).config, 'utf8')
}

function readLocalConfigFile(root: string): string {
  return readFileSync(projectPaths(root).localConfig, 'utf8')
}

function parseConfigDocument(text: string): Record<string, unknown> {
  const parsed = parseYaml(text)
  return isRecord(parsed) ? parsed : {}
}

function parseProjectConfig(parsed: Record<string, unknown>): ProjectConfig {
  const worktreeRoot = parseWorktreeRoot(parsed.workspace, DEFAULT_CONFIG.workspace.worktreeRoot)
  return {
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : DEFAULT_CONFIG.name,
    multiplexer: parseMultiplexer(parsed.multiplexer) ?? DEFAULT_CONFIG.multiplexer,
    workspace: {
      mainBranch:
        isRecord(parsed.workspace) && typeof parsed.workspace.mainBranch === 'string'
          ? parsed.workspace.mainBranch
          : DEFAULT_CONFIG.workspace.mainBranch,
      worktreeRoot,
      worktrees: { root: worktreeRoot },
      defaultAgent: isRecord(parsed.workspace)
        ? parseAgentKind(parsed.workspace.defaultAgent)
        : DEFAULT_CONFIG.workspace.defaultAgent,
      autoPull: isRecord(parsed.workspace)
        ? parseAutoPull(parsed.workspace.autoPull)
        : DEFAULT_CONFIG.workspace.autoPull,
    },
    profiles: parseProfiles(parsed.profiles, true),
    exposure: parseExposure(parsed.exposure),
    agents: {},
    providers: parseAcpProviders(parsed.providers),
    services: parseServices(parsed.services),
    startupEnvs: parseStartupEnvs(parsed.startupEnvs),
    integrations: {
      github: {
        linkedRepos:
          isRecord(parsed.integrations) && isRecord(parsed.integrations.github)
            ? parseLinkedRepos(parsed.integrations.github.linkedRepos)
            : isRecord(parsed.integrations) && Array.isArray(parsed.integrations.github)
              ? parseLinkedRepos(parsed.integrations.github)
              : [],
        autoRemoveOnMerge:
          isRecord(parsed.integrations) &&
          isRecord(parsed.integrations.github) &&
          typeof parsed.integrations.github.autoRemoveOnMerge === 'boolean'
            ? parsed.integrations.github.autoRemoveOnMerge
            : DEFAULT_CONFIG.integrations.github.autoRemoveOnMerge,
      },
      linear: parseLinearIntegration(parsed),
    },
    lifecycleHooks: parseLifecycleHooks(parsed.lifecycleHooks),
    autoName: parseAutoName(parsed.auto_name),
    oneshot: parseOneshot(parsed.oneshot),
  }
}

function defaultConfig(): ProjectConfig {
  return parseProjectConfig({})
}

function parseTeamKeyList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const keys = raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0)
  return keys.length > 0 ? Array.from(new Set(keys)) : undefined
}

function parseLinearIntegration(parsed: Record<string, unknown>): LinearIntegrationConfig {
  const defaults = DEFAULT_CONFIG.integrations.linear
  const linear =
    isRecord(parsed.integrations) && isRecord(parsed.integrations.linear) ? parsed.integrations.linear : null

  if (!linear) return { ...defaults }

  const watchTeams = parseTeamKeyList(linear.watchTeams)

  return {
    enabled: typeof linear.enabled === 'boolean' ? linear.enabled : defaults.enabled,
    autoCreateWorktrees:
      typeof linear.autoCreateWorktrees === 'boolean' ? linear.autoCreateWorktrees : defaults.autoCreateWorktrees,
    createTicketOption:
      typeof linear.createTicketOption === 'boolean' ? linear.createTicketOption : defaults.createTicketOption,
    ...(watchTeams ? { watchTeams } : {}),
  }
}

function parseLocalLinearOverlay(parsed: Record<string, unknown>): Partial<LinearIntegrationConfig> | null {
  if (!isRecord(parsed.integrations)) return null
  const linear = parsed.integrations.linear
  if (!isRecord(linear)) return null

  const overlay: Partial<LinearIntegrationConfig> = {}
  if (typeof linear.enabled === 'boolean') overlay.enabled = linear.enabled
  if (typeof linear.autoCreateWorktrees === 'boolean') overlay.autoCreateWorktrees = linear.autoCreateWorktrees
  if (typeof linear.createTicketOption === 'boolean') overlay.createTicketOption = linear.createTicketOption
  const watchTeams = parseTeamKeyList(linear.watchTeams)
  if (watchTeams) overlay.watchTeams = watchTeams
  return Object.keys(overlay).length > 0 ? overlay : null
}

function parseLocalGitHubOverlay(parsed: Record<string, unknown>): Partial<GitHubIntegrationConfig> | null {
  if (!isRecord(parsed.integrations)) return null
  const github = parsed.integrations.github
  if (!isRecord(github)) return null

  const overlay: Partial<GitHubIntegrationConfig> = {}
  if (typeof github.autoRemoveOnMerge === 'boolean') overlay.autoRemoveOnMerge = github.autoRemoveOnMerge
  return Object.keys(overlay).length > 0 ? overlay : null
}

function parseLocalAutoPullOverlay(parsed: Record<string, unknown>): Partial<AutoPullConfig> | null {
  if (!isRecord(parsed.workspace)) return null
  const autoPull = parsed.workspace.autoPull
  if (!isRecord(autoPull)) return null

  const overlay: Partial<AutoPullConfig> = {}
  if (typeof autoPull.enabled === 'boolean') overlay.enabled = autoPull.enabled
  if (
    typeof autoPull.intervalSeconds === 'number' &&
    Number.isFinite(autoPull.intervalSeconds) &&
    autoPull.intervalSeconds >= 30
  ) {
    overlay.intervalSeconds = autoPull.intervalSeconds
  }
  return Object.keys(overlay).length > 0 ? overlay : null
}

function loadLocalProjectConfigOverlay(root: string): LocalProjectConfigOverlay {
  try {
    const text = readLocalConfigFile(root).trim()
    if (!text) {
      return {
        multiplexer: null,
        worktreeRoot: null,
        profiles: {},
        agents: {},
        providers: {},
        lifecycleHooks: {},
        linear: null,
        github: null,
        autoPull: null,
      }
    }

    const parsed = parseConfigDocument(text)
    const ws = isRecord(parsed.workspace) ? parsed.workspace : null
    return {
      multiplexer: parseMultiplexer(parsed.multiplexer),
      worktreeRoot: ws ? parseWorktreeRoot(ws, '') || null : null,
      profiles: parseProfiles(parsed.profiles, false),
      agents: parseCustomAgents(parsed.agents),
      providers: parseAcpProviders(parsed.providers),
      lifecycleHooks: parseLifecycleHooks(parsed.lifecycleHooks),
      linear: parseLocalLinearOverlay(parsed),
      github: parseLocalGitHubOverlay(parsed),
      autoPull: parseLocalAutoPullOverlay(parsed),
    }
  } catch {
    return {
      multiplexer: null,
      worktreeRoot: null,
      profiles: {},
      agents: {},
      providers: {},
      lifecycleHooks: {},
      linear: null,
      github: null,
      autoPull: null,
    }
  }
}

function mergeHookCommand(projectCommand: string | undefined, localCommand: string | undefined): string | undefined {
  if (projectCommand && localCommand) {
    return ['set -e', projectCommand, localCommand].join('\n')
  }

  return localCommand ?? projectCommand
}

function mergeLifecycleHooks(
  projectHooks: LifecycleHooksConfig,
  localHooks: LifecycleHooksConfig,
): LifecycleHooksConfig {
  const postCreate = mergeHookCommand(projectHooks.postCreate, localHooks.postCreate)
  const preRemove = mergeHookCommand(projectHooks.preRemove, localHooks.preRemove)

  return {
    ...(postCreate ? { postCreate } : {}),
    ...(preRemove ? { preRemove } : {}),
  }
}

/** Resolve the git repository root from a directory. */
export function gitRoot(dir: string): string {
  const root = gitRevParse(dir, '--show-toplevel')
  return root || dir
}

/** Resolve the shared project root for a repository, even from a linked worktree. */
export function projectRoot(dir: string): string {
  const commonDir = gitRevParse(dir, '--git-common-dir')
  return commonDir ? dirname(resolve(dir, commonDir)) : gitRoot(dir)
}

function gitRevParse(dir: string, argument: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', argument], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return output || null
  } catch {
    return null
  }
}

/** Load `.portta/taskflow.yaml` from the shared project root into the final project config shape. */
export function loadConfig(dir: string, options: LoadConfigOptions = {}): ProjectConfig {
  const root = options.resolvedRoot ? dir : projectRoot(dir)

  let projectConfig: ProjectConfig
  try {
    const text = readConfigFile(root).trim()
    projectConfig = text ? parseProjectConfig(parseConfigDocument(text)) : defaultConfig()
  } catch {
    projectConfig = defaultConfig()
  }

  const localOverlay = loadLocalProjectConfigOverlay(root)

  const workspace =
    localOverlay.worktreeRoot !== null || localOverlay.autoPull
      ? {
          ...projectConfig.workspace,
          ...(localOverlay.worktreeRoot !== null
            ? { worktreeRoot: localOverlay.worktreeRoot, worktrees: { root: localOverlay.worktreeRoot } }
            : {}),
          ...(localOverlay.autoPull
            ? { autoPull: { ...projectConfig.workspace.autoPull, ...localOverlay.autoPull } }
            : {}),
        }
      : projectConfig.workspace

  const hasIntegrationOverlay = localOverlay.linear || localOverlay.github
  const integrations = hasIntegrationOverlay
    ? {
        ...projectConfig.integrations,
        ...(localOverlay.linear ? { linear: { ...projectConfig.integrations.linear, ...localOverlay.linear } } : {}),
        ...(localOverlay.github ? { github: { ...projectConfig.integrations.github, ...localOverlay.github } } : {}),
      }
    : projectConfig.integrations

  return {
    ...projectConfig,
    ...(localOverlay.multiplexer ? { multiplexer: localOverlay.multiplexer } : {}),
    workspace,
    profiles: {
      ...cloneProfiles(projectConfig.profiles),
      ...cloneProfiles(localOverlay.profiles),
    },
    agents: {
      ...cloneAgents(projectConfig.agents),
      ...cloneAgents(localOverlay.agents),
    },
    providers: {
      ...cloneAcpProviders(projectConfig.providers),
      ...cloneAcpProviders(localOverlay.providers),
    },
    lifecycleHooks: mergeLifecycleHooks(projectConfig.lifecycleHooks, localOverlay.lifecycleHooks),
    integrations,
  }
}

function readLocalConfigDocument(root: string): { localPath: string; existing: Record<string, unknown> } {
  const localPath = projectPaths(root).localConfig

  let existing: Record<string, unknown> = {}
  try {
    const text = readFileSync(localPath, 'utf8').trim()
    if (text) existing = parseConfigDocument(text)
  } catch {
    /* file doesn't exist yet */
  }

  return { localPath, existing }
}

async function writeLocalConfig(localPath: string, existing: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(localPath), { recursive: true })
  await writeFile(localPath, stringifyYaml(existing))
}

/** Persist a partial Linear integration config override into `.portta/taskflow.local.yaml`.
 *  Reads the existing file, merges the changes under `integrations.linear`, and writes back. */
export async function persistLocalLinearConfig(dir: string, changes: Partial<LinearIntegrationConfig>): Promise<void> {
  const root = projectRoot(dir)
  const { localPath, existing } = readLocalConfigDocument(root)

  const integrations = isRecord(existing.integrations) ? { ...existing.integrations } : {}
  const linear = isRecord(integrations.linear) ? { ...integrations.linear } : {}
  Object.assign(linear, changes)
  integrations.linear = linear
  existing.integrations = integrations

  await writeLocalConfig(localPath, existing)
}

/** Persist the multiplexer choice into `.portta/taskflow.local.yaml`.
 *
 *  Deliberately the *local* overlay rather than `.portta/taskflow.yaml`: which multiplexer
 *  is running is a per-machine fact, not something a project commits for everyone. */
export async function persistLocalMultiplexer(dir: string, multiplexer: MultiplexerKind): Promise<void> {
  const root = projectRoot(dir)
  const { localPath, existing } = readLocalConfigDocument(root)
  existing.multiplexer = multiplexer
  await writeLocalConfig(localPath, existing)
}

/** Persist a partial GitHub integration config override into `.portta/taskflow.local.yaml`. */
export async function persistLocalGitHubConfig(dir: string, changes: Partial<GitHubIntegrationConfig>): Promise<void> {
  const root = projectRoot(dir)
  const { localPath, existing } = readLocalConfigDocument(root)

  const integrations = isRecord(existing.integrations) ? { ...existing.integrations } : {}
  const github = isRecord(integrations.github) ? { ...integrations.github } : {}
  Object.assign(github, changes)
  integrations.github = github
  existing.integrations = integrations

  await writeLocalConfig(localPath, existing)
}

export async function persistLocalCustomAgent(dir: string, agentId: AgentId, agent: CustomAgentConfig): Promise<void> {
  const root = projectRoot(dir)
  const { localPath, existing } = readLocalConfigDocument(root)
  const agents = isRecord(existing.agents) ? { ...existing.agents } : {}

  agents[agentId] = {
    label: agent.label,
    startCommand: agent.startCommand,
    ...(agent.resumeCommand ? { resumeCommand: agent.resumeCommand } : {}),
  } satisfies Record<string, unknown>
  existing.agents = agents

  await writeLocalConfig(localPath, existing)
}

export async function removeLocalCustomAgent(dir: string, agentId: AgentId): Promise<void> {
  const root = projectRoot(dir)
  const { localPath, existing } = readLocalConfigDocument(root)
  if (!isRecord(existing.agents) || !(agentId in existing.agents)) {
    return
  }

  const agents = { ...existing.agents }
  delete agents[agentId]

  if (Object.keys(agents).length === 0) {
    delete existing.agents
  } else {
    existing.agents = agents
  }

  await writeLocalConfig(localPath, existing)
}

/** Expand ${VAR} placeholders in a template string using an env map. */
export function expandTemplate(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? '')
}
