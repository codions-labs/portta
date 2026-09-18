export type AgentKind = 'claude' | 'codex'
/** Which multiplexer backs a project's panes. `tmux` is the default; `herdr`
 *  drives herdr's local socket API instead (see adapters/herdr.ts). */
export type MultiplexerKind = 'tmux' | 'herdr'
export type AgentId = string
export type RuntimeKind = 'host' | 'docker'
export type RuntimeSelection = RuntimeKind | 'compose' | 'devcontainer' | 'dockerfile' | 'auto'
export type SessionInterfaceMode = 'terminal' | 'web_chat'

export interface CustomAgentConfig {
  label: string
  startCommand: string
  resumeCommand?: string
}
/** One entry of the ACP provider registry: the adapter command a provider id
 *  launches over the Agent Client Protocol. Builtins ship with the host; a
 *  Project declares more (or replaces a builtin) under `providers:`. */
export interface AcpProviderConfig {
  label: string
  command: string
  args: string[]
}
/** A runtime pane follows and controls the environment selected for a session. */
export type PaneKind = 'agent' | 'shell' | 'command' | 'runtime'
export type PaneSplit = 'right' | 'bottom'

export interface AutoPullConfig {
  enabled: boolean
  intervalSeconds: number
}

export interface WorkspaceConfig {
  mainBranch: string
  /** Normalized worktree root, the same value as `worktrees.root`. */
  worktreeRoot: string
  /** Declarative worktree placement. `root` and `worktreeRoot` always agree
   * after config loading. */
  worktrees: {
    root: string
  }
  defaultAgent: AgentKind
  autoPull: AutoPullConfig
}

export interface PaneTemplate {
  id: string
  kind: PaneKind
  split?: PaneSplit
  sizePct?: number
  focus?: boolean
  command?: string
  cwd?: 'worktree' | 'repo'
  workingDir?: string
}

export interface MountSpec {
  hostPath: string
  guestPath?: string
  writable?: boolean
}

export interface ProfileConfig {
  runtime: RuntimeKind
  systemPrompt?: string
  envPassthrough: string[]
  yolo?: boolean
  panes: PaneTemplate[]
  image?: string
  mounts?: MountSpec[]
  environment?: {
    provider?: RuntimeSelection
    config?: string
    agentService?: string
    /** Command owned by the Runtime pane when the resolved provider is host. */
    command?: string
    /** Directory relative to the selected workspace where the host command runs. */
    cwd?: string
    /** Optional cleanup command for host runtimes that spawn detached processes. */
    stopCommand?: string
  }
}

export interface ExposureConfig {
  local: {
    /** `loopback` creates private loopback forwards for container services;
     * `disabled` creates no endpoints at all. */
    provider: 'loopback' | 'disabled'
    /** Whether detected container services receive local endpoints on startup. */
    autoExpose: 'all' | 'http' | 'manual'
  }
}

export interface ServiceSpec {
  name: string
  portEnv: string
  portStart?: number
  portStep?: number
  urlTemplate?: string
  protocol?: 'http' | 'https' | 'tcp' | 'udp'
}

export interface LinkedRepoConfig {
  repo: string
  alias: string
  dir?: string
}

export interface GitHubIntegrationConfig {
  linkedRepos: LinkedRepoConfig[]
  autoRemoveOnMerge: boolean
}

export interface LinearIntegrationConfig {
  enabled: boolean
  autoCreateWorktrees: boolean
  createTicketOption: boolean
  /** Restrict the auto-create watcher to issues from these team keys (e.g. ["ENG", "OPS"]).
   *  When unset, all teams the authenticated user is assigned in are watched. */
  watchTeams?: string[]
}

export interface IntegrationConfig {
  github: GitHubIntegrationConfig
  linear: LinearIntegrationConfig
}

export interface LifecycleHooksConfig {
  postCreate?: string
  preRemove?: string
}

export interface AutoNameConfig {
  provider: 'claude' | 'codex'
  model?: string
  systemPrompt?: string
}

export interface OneshotConfig {
  systemPrompt: string
}

export interface ProjectConfig {
  name: string
  /** Which multiplexer backs this project's panes. Defaults to tmux. */
  multiplexer: MultiplexerKind
  workspace: WorkspaceConfig
  exposure: ExposureConfig
  profiles: Record<string, ProfileConfig>
  agents: Record<AgentId, CustomAgentConfig>
  /** ACP providers declared by the Project, keyed by provider id. Merged over
   *  the builtin registry at runtime; an empty map means builtins only. */
  providers: Record<string, AcpProviderConfig>
  services: ServiceSpec[]
  startupEnvs: Record<string, string | boolean>
  integrations: IntegrationConfig
  lifecycleHooks: LifecycleHooksConfig
  autoName: AutoNameConfig | null
  oneshot: OneshotConfig
}
