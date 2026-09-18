/** The module's name inside Portta. Paths, environment and the host service belong to Portta. */
export const APP_NAME = 'Taskflow'
export const APP_SLUG = 'taskflow'
/** How a person types the module's commands. */
export const CLI_NAME = 'portta flow'
export const UI_STORAGE_PREFIX = APP_SLUG

/** PORTTA_HOME's default, relative to the user's home directory. */
export const GLOBAL_CONFIG_DIR = '.portta'
/** Where the host daemon keeps its state inside PORTTA_HOME. */
export const HOST_STATE_DIR = 'state/host'
export const PROJECT_CONFIG_DIR = '.portta'

export const PATH_NAMES = {
  projectConfig: `${APP_SLUG}.yaml`,
  projectLocalConfig: `${APP_SLUG}.local.yaml`,
  projectConfigExample: `${APP_SLUG}.example.yaml`,
  env: '.env',
  controlToken: 'token',
  projectsRegistry: 'projects.json',
  database: `${APP_SLUG}.db`,
  runs: 'runs',
  workflows: 'workflows',
  worktrees: 'worktrees',
  gitRuntime: 'portta',
  worktreeMeta: 'meta.json',
  runtimeEnv: 'runtime.env',
  controlEnv: 'control.env',
  pullRequests: 'prs.json',
  archiveState: 'archive.json',
  openSessionsState: 'open-sessions.json',
} as const

export const PROJECT_CONFIG_PATH = `${PROJECT_CONFIG_DIR}/${PATH_NAMES.projectConfig}`
export const PROJECT_LOCAL_CONFIG_PATH = `${PROJECT_CONFIG_DIR}/${PATH_NAMES.projectLocalConfig}`

export const APP_DEFAULTS = {
  port: 5111,
  projectName: APP_NAME,
  mainBranch: 'main',
  worktreeRoot: '.portta/worktrees',
  defaultAgent: 'claude',
  multiplexer: 'tmux',
} as const

export const ENV_NAMES = {
  home: 'PORTTA_HOME',
  hostStateDir: 'PORTTA_HOST_STATE_DIR',
  host: 'PORTTA_HOST_BIND',
  hostPort: 'PORTTA_HOST_PORT',
  controlUrl: 'PORTTA_FLOW_CONTROL_URL',
  controlToken: 'PORTTA_FLOW_CONTROL_TOKEN',
  projectAllowlist: 'PORTTA_FLOW_PROJECT_ALLOWLIST',
  projectDir: 'PORTTA_FLOW_PROJECT_DIR',
  projectEnvKeys: 'PORTTA_FLOW_PROJECT_ENV_KEYS',
  workflowBuiltinsDir: 'PORTTA_FLOW_WORKFLOW_BUILTINS_DIR',
  debug: 'PORTTA_FLOW_DEBUG',
  isolatedTmuxConfig: 'PORTTA_FLOW_ISOLATED_TMUX_CONFIG',
  isolatedTmuxSocket: 'PORTTA_FLOW_ISOLATED_TMUX_SOCKET',
  worktreeId: 'PORTTA_FLOW_WORKTREE_ID',
  branch: 'PORTTA_FLOW_BRANCH',
  profile: 'PORTTA_FLOW_PROFILE',
  agent: 'PORTTA_FLOW_AGENT',
  agentPermissionMode: 'PORTTA_FLOW_AGENT_PERMISSION_MODE',
  runtime: 'PORTTA_FLOW_RUNTIME',
  worktreePath: 'PORTTA_FLOW_WORKTREE_PATH',
  agentPrompt: 'PORTTA_FLOW_AGENT_PROMPT',
  agentSystemPrompt: 'PORTTA_FLOW_AGENT_SYSTEM_PROMPT',
  agentWorktreePath: 'PORTTA_FLOW_AGENT_WORKTREE_PATH',
  agentRepoPath: 'PORTTA_FLOW_AGENT_REPO_PATH',
  agentBranch: 'PORTTA_FLOW_AGENT_BRANCH',
  agentProfile: 'PORTTA_FLOW_AGENT_PROFILE',
} as const

export const AGENT_TEMPLATE_VARIABLES = [
  'PROMPT',
  'SYSTEM_PROMPT',
  'WORKTREE_PATH',
  'REPO_PATH',
  'BRANCH',
  'PROFILE',
] as const

export function agentTemplatePlaceholder(variable: (typeof AGENT_TEMPLATE_VARIABLES)[number]): string {
  return `\${${variable}}`
}

export const RUNTIME_IDENTITY = {
  agentControlBinary: 'portta-agentctl',
  codexClientName: `${APP_SLUG}-agents`,
  tmuxPrefix: 'tf',
  terminalSessionPrefix: `${APP_SLUG}-dash`,
  nativeTerminalSessionPrefix: `${APP_SLUG}-native`,
  tmuxBufferPrefix: `${APP_SLUG}-prompt`,
  dockerContainerPrefix: APP_SLUG,
  tempUploadDir: `${APP_SLUG}-uploads`,
  gitBaseConfigKey: `${APP_SLUG}.base`,
} as const

export const SERVICE_IDENTITY = {
  name: 'portta-host',
  launchdLabelPrefix: 'com.portta',
  launchdLabel: 'com.portta.host',
  description: 'Portta host daemon',
  logFile: 'portta-host.log',
} as const

export const LINEAR_IDENTITY = {
  label: APP_SLUG,
  oneshotLabel: `${APP_SLUG}_oneshot`,
  attachmentTitlePrefix: `${APP_SLUG}-state:`,
  attachmentPayloadKey: APP_SLUG,
  attachmentSource: `${APP_SLUG}-attachment`,
} as const

/** The host's listening port: `PORTTA_HOST_PORT`, then `PORT`, then the default. */
export function hostPortFromEnv(env: Readonly<Record<string, string | undefined>>): number {
  return parseInt(env[ENV_NAMES.hostPort] || env.PORT || String(APP_DEFAULTS.port), 10)
}
