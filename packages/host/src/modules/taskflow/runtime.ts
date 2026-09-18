import type { MultiplexerKind } from 'portta-core/taskflow'
import { ENV_NAMES, hostPortFromEnv } from 'portta-core/taskflow/config'
import { globalPaths } from 'portta-core/taskflow/paths'
import { hostTokenFile, readOrCreateToken } from '../../token.ts'
import { loadConfig, type ProjectConfig, projectRoot } from './adapters/config.ts'
import { NodeDockerGateway } from './adapters/docker.ts'
import { NodeGitGateway } from './adapters/git.ts'
import { HerdrGateway } from './adapters/herdr.ts'
import { NodeLifecycleHookRunner } from './adapters/hooks.ts'
import { NodePortProbe } from './adapters/port-probe.ts'
import type { RunStore } from './adapters/run-store.ts'
import { FileSessionDiscovery, type SessionDiscoveryGateway } from './adapters/session-discovery.ts'
import type { SessionGateway } from './adapters/session-gateway.ts'
import { TmuxGateway } from './adapters/tmux.ts'
import { ArchiveStateService } from './services/archive-state-service.ts'
import { AutoNameService } from './services/auto-name-service.ts'
import { type CreateWorktreeProgress, LifecycleService } from './services/lifecycle-service.ts'
import { NotificationService as RuntimeNotificationService } from './services/notification-service.ts'
import { ProjectRuntime } from './services/project-runtime.ts'
import { ReconciliationService } from './services/reconciliation-service.ts'
import type { RunService } from './services/run-service.ts'
import { WorktreeCreationTracker } from './services/worktree-creation-service.ts'

export interface TaskflowRuntimeOptions {
  projectDir?: string
  port?: number
  /** Address the host daemon listens on, for the control URL agent hooks report to. */
  host?: string
  /** URL-path prefix the server mounts this project's routes under. Agent hooks
   *  POST status events to the control URL, which must carry the same prefix or
   *  the events fall through to the SPA and Claude's status never updates. */
  prefix?: string
  onCreateProgress?: (progress: CreateWorktreeProgress) => void | Promise<void>
  runStore?: RunStore
  runService?: RunService
}

/** Where the host daemon serves this module, below its origin. */
export const TASKFLOW_MOUNT_PATH = '/api/modules/taskflow'

/** Base URL agent hooks POST runtime events to. The daemon serves each project
 *  under `/api/modules/taskflow/${prefix}` (see server/app.ts and the module in
 *  index.ts), so the control URL must carry both or the events reach no route
 *  and the agent's status never updates.
 *
 *  `host` is where the daemon listens; a wildcard bind is reached on loopback.
 *
 *  `undefined` prefix means control reporting is not configured (the CLI passes
 *  it when it can't resolve a prefix — no daemon running). We return undefined
 *  rather than an unprefixed URL so no control.env is written and the agent's
 *  hooks no-op cleanly instead of POSTing to an unrouted path. */
export function buildControlBaseUrl(port: number, prefix: string | undefined, host = '127.0.0.1'): string | undefined {
  if (prefix === undefined || prefix === '') return undefined
  const reachable = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host
  const origin = `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}`
  return `${origin}${TASKFLOW_MOUNT_PATH}/${prefix}`
}

/** The token agent hooks present: the host daemon's own, from its state directory. */
export async function loadControlToken(): Promise<string> {
  return readOrCreateToken(hostTokenFile(globalPaths().root))
}

/** Build the gateway backing a project's panes. tmux is the default; `herdr`
 *  swaps in herdr's socket API (see docs/herdr.md for what differs). */
export function createSessionGateway(multiplexer: MultiplexerKind): SessionGateway {
  return multiplexer === 'herdr' ? new HerdrGateway() : new TmuxGateway()
}

export interface TaskflowRuntime {
  port: number
  projectDir: string
  config: ProjectConfig
  archiveStateService: ArchiveStateService
  git: NodeGitGateway
  portProbe: NodePortProbe
  sessions: SessionGateway
  sessionDiscovery: SessionDiscoveryGateway
  docker: NodeDockerGateway
  hooks: NodeLifecycleHookRunner
  autoName: AutoNameService
  projectRuntime: ProjectRuntime
  worktreeCreationTracker: WorktreeCreationTracker
  runtimeNotifications: RuntimeNotificationService
  runStore?: RunStore
  runService?: RunService
  reconciliationService: ReconciliationService
  lifecycleService: LifecycleService
}

export function createTaskflowRuntime(options: TaskflowRuntimeOptions = {}): TaskflowRuntime {
  const port = options.port ?? hostPortFromEnv(process.env)
  // ProjectManager (the only server-side caller) always passes an explicit
  // projectDir; cwd is just the default for direct/CLI/test calls.
  const projectDir = projectRoot(options.projectDir ?? process.cwd())
  const config = loadConfig(projectDir, { resolvedRoot: true })
  const git = new NodeGitGateway()
  const archiveStateService = new ArchiveStateService(git.resolveWorktreeGitDir(projectDir))
  const portProbe = new NodePortProbe()
  const sessions = createSessionGateway(config.multiplexer)
  const sessionDiscovery = new FileSessionDiscovery()
  const docker = new NodeDockerGateway()
  const hooks = new NodeLifecycleHookRunner()
  const autoName = new AutoNameService()
  const projectRuntime = new ProjectRuntime()
  const worktreeCreationTracker = new WorktreeCreationTracker()
  const runtimeNotifications = new RuntimeNotificationService()
  const reconciliationService = new ReconciliationService({
    config,
    git,
    sessions,
    portProbe,
    runtime: projectRuntime,
  })
  const lifecycleService = new LifecycleService({
    projectRoot: projectDir,
    controlBaseUrl: buildControlBaseUrl(port, options.prefix, options.host ?? process.env[ENV_NAMES.host]),
    getControlToken: loadControlToken,
    config,
    archiveState: archiveStateService,
    git,
    sessions,
    sessionDiscovery,
    docker,
    reconciliation: reconciliationService,
    hooks,
    autoName,
    onCreateProgress: (progress) => {
      worktreeCreationTracker.set(progress)
      options.onCreateProgress?.(progress)
    },
    onCreateFinished: (branch) => {
      worktreeCreationTracker.clear(branch)
    },
  })

  return {
    port,
    projectDir,
    config,
    archiveStateService,
    git,
    portProbe,
    sessions,
    sessionDiscovery,
    docker,
    hooks,
    autoName,
    projectRuntime,
    worktreeCreationTracker,
    runtimeNotifications,
    runStore: options.runStore,
    runService: options.runService,
    reconciliationService,
    lifecycleService,
  }
}
