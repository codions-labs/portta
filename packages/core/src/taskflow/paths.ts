import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  ENV_NAMES,
  GLOBAL_CONFIG_DIR,
  HOST_STATE_DIR,
  PATH_NAMES,
  PROJECT_CONFIG_DIR,
  RUNTIME_IDENTITY,
} from './config.ts'

export interface GlobalPathOptions {
  home?: string
  env?: NodeJS.ProcessEnv
}

export function globalConfigDir(options: GlobalPathOptions = {}): string {
  const env = options.env ?? process.env
  const override = env[ENV_NAMES.home]?.trim()
  return override || join(options.home ?? env.HOME ?? homedir(), GLOBAL_CONFIG_DIR)
}

export function globalPaths(options: GlobalPathOptions = {}) {
  const home = globalConfigDir(options)
  const env = options.env ?? process.env
  const root = env[ENV_NAMES.hostStateDir]?.trim() || join(home, HOST_STATE_DIR)
  return {
    root,
    env: join(home, PATH_NAMES.env),
    controlToken: join(root, PATH_NAMES.controlToken),
    projectsRegistry: join(root, PATH_NAMES.projectsRegistry),
    database: join(root, PATH_NAMES.database),
    runs: join(root, PATH_NAMES.runs),
    workflows: join(root, PATH_NAMES.workflows),
  }
}

export function projectPaths(projectRoot: string) {
  const root = join(projectRoot, PROJECT_CONFIG_DIR)
  return {
    root,
    config: join(root, PATH_NAMES.projectConfig),
    localConfig: join(root, PATH_NAMES.projectLocalConfig),
    configExample: join(root, PATH_NAMES.projectConfigExample),
    workflows: join(root, PATH_NAMES.workflows),
    worktrees: join(root, PATH_NAMES.worktrees),
  }
}

export function gitRuntimePaths(gitDir: string) {
  const root = join(gitDir, PATH_NAMES.gitRuntime)
  return {
    root,
    meta: join(root, PATH_NAMES.worktreeMeta),
    runtimeEnv: join(root, PATH_NAMES.runtimeEnv),
    controlEnv: join(root, PATH_NAMES.controlEnv),
    pullRequests: join(root, PATH_NAMES.pullRequests),
    archiveState: join(root, PATH_NAMES.archiveState),
    openSessionsState: join(root, PATH_NAMES.openSessionsState),
    agentControl: join(root, RUNTIME_IDENTITY.agentControlBinary),
  }
}
