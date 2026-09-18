// Taskflow, as the host daemon runs it.
//
// The daemon owns the listener, the token and the upgrade handler; this module
// owns everything behind them. Its HTTP routes answer at
// `/api/modules/taskflow/…` (global routes such as `api/projects`, and each
// Project's under `<prefix>/api/…`), its sockets at
// `/ws/modules/taskflow/<prefix>/ws/…`, and the panel forwards both 1:1.
//
// The Projects, their background loops and the tmux server are brought up once,
// the first time the daemon asks for the routes, and wound down in `close`.

import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { taskflowModule } from 'portta-core/modules'
import { ENV_NAMES } from 'portta-core/taskflow/config'
import { globalPaths } from 'portta-core/taskflow/paths'
import { bearerToken, tokenMatches } from '../../auth.ts'
import { hostListen } from '../../config.ts'
import { hostTokenFile, readOrCreateToken } from '../../token.ts'
import type { HostContext, HostModule } from '../index.ts'
import { loadConfig, projectRoot } from './adapters/config.ts'
import { DevContainerProvider } from './adapters/devcontainer-environment.ts'
import { DockerfileEnvironmentProvider } from './adapters/dockerfile-environment.ts'
import { disabledEndpointExposure } from './adapters/endpoint-exposure.ts'
import { createEnvironmentStore } from './adapters/environment-store.ts'
import { HostEnvironmentProvider } from './adapters/host-environment.ts'
import { NodeProcessRunner } from './adapters/process-runner.ts'
import { createProjectsRegistry } from './adapters/projects-registry.ts'
import { cleanupStaleSessions } from './adapters/terminal.ts'
import { synchronizeTmuxPath } from './adapters/tmux.ts'
import { taskflowAssets } from './assets.ts'
import { log } from './lib/log.ts'
import { refreshHostShellPath } from './lib/user-shell-env.ts'
import { createTaskflowHost, type TaskflowHost } from './server/host.ts'
import { isGitRepo } from './server/host-projects.ts'
import { DockerServiceDiscoverySource } from './services/environment-service-discovery.ts'
import { loadProjectAllowlist } from './services/project-allowlist.ts'

declare const __PORTTA_BUILD_DATE__: string

/** Where the module's sockets are mounted on the daemon. */
export const TASKFLOW_SOCKET_MOUNT_PATH = `/ws/modules/${taskflowModule.id}`

export interface TaskflowHostModuleOptions {
  /** Builds the host for a daemon context. Tests pass one with no Project. */
  createHost?: (context: HostContext) => TaskflowHost
  /** Brings the multiplexer up and loads the persisted Projects. Tests skip it. */
  start?: (host: TaskflowHost, context: HostContext) => Promise<void>
}

/** Ensure the tmux server is running (it needs at least one session to persist).
 *  Only meaningful for the tmux backend — herdr has no equivalent bootstrap and
 *  brings its server up through SessionGateway.ensureServer instead. */
async function bootstrapMultiplexer(cwd: string): Promise<void> {
  const bootstrapRoot = isGitRepo(cwd) ? projectRoot(cwd) : cwd
  const hostShellPath = await refreshHostShellPath()
  if (loadConfig(bootstrapRoot).multiplexer !== 'tmux') return
  if (hostShellPath.path) synchronizeTmuxPath(hostShellPath.path)
  const tmuxCheck = spawnSync('tmux', ['list-sessions'], { stdio: 'ignore' })
  if (tmuxCheck.status !== 0) {
    spawnSync('tmux', ['new-session', '-d', '-s', '0'], { stdio: 'ignore' })
    log.info('Started tmux session')
  }
  cleanupStaleSessions()
}

async function startTaskflowHost(host: TaskflowHost, context: HostContext): Promise<void> {
  const cwd = context.env[ENV_NAMES.projectDir] ?? process.cwd()
  await bootstrapMultiplexer(cwd)
  host.loadProjects(cwd)
  log.info(`[taskflow] serving ${host.projects.list().length} project(s)`)
}

/** The module's state paths, rooted at the daemon's state directory. */
function statePaths(context: HostContext): ReturnType<typeof globalPaths> {
  return globalPaths({ env: { ...context.env, [ENV_NAMES.hostStateDir]: context.stateDir } })
}

export function createDaemonTaskflowHost(context: HostContext): TaskflowHost {
  const env = context.env
  const paths = statePaths(context)
  const token = readOrCreateToken(hostTokenFile(context.stateDir))
  const processRunner = new NodeProcessRunner()
  return createTaskflowHost({
    projectHost: {
      // The daemon's own reading of the port, so control URLs name where it listens.
      port: hostListen(env).port,
      workflowBuiltinsDir: taskflowAssets(env).workflowBuiltinsDir,
      version: env.PORTTA_VERSION || '0.0.0-local',
      buildDate: typeof __PORTTA_BUILD_DATE__ === 'string' ? __PORTTA_BUILD_DATE__ : new Date().toISOString(),
      environmentStore: createEnvironmentStore(paths.database),
      hostEnvironmentProvider: new HostEnvironmentProvider(),
      devContainerProvider: new DevContainerProvider(),
      dockerfileEnvironmentProvider: new DockerfileEnvironmentProvider(),
      processRunner,
      dockerServiceDiscovery: new DockerServiceDiscoverySource(processRunner),
      endpointExposure: disabledEndpointExposure,
    },
    registry: createProjectsRegistry(paths.projectsRegistry),
    projectAllowlist: loadProjectAllowlist({ spec: env[ENV_NAMES.projectAllowlist], fallbackRoots: [homedir()] }),
    hasValidToken: async (request) => tokenMatches(bearerToken(request.headers.get('authorization')), token),
  })
}

export function createTaskflowHostModule(options: TaskflowHostModuleOptions = {}): HostModule {
  const createHost = options.createHost ?? createDaemonTaskflowHost
  const start = options.start ?? startTaskflowHost
  let host: TaskflowHost | null = null
  let started: Promise<void> | null = null

  const hostFor = (context: HostContext): TaskflowHost => {
    if (host) return host
    // Taskflow's adapters resolve their paths from the environment; the
    // daemon's state directory is the one they must agree on.
    if (context.env === process.env) process.env[ENV_NAMES.hostStateDir] = context.stateDir
    host = createHost(context)
    const created = host
    started = start(created, context).catch((error: unknown) => {
      log.error(`[taskflow] failed to start: ${error instanceof Error ? error.message : String(error)}`)
    })
    return created
  }

  return {
    manifest: taskflowModule,
    routes: (context) => hostFor(context).app,
    ws: (context) =>
      hostFor(context).sockets.map((route) => ({
        path: `${TASKFLOW_SOCKET_MOUNT_PATH}${route.path}`,
        accepts: route.accepts,
        handle: (socket, { params }) => route.handle(socket, params),
      })),
    close: async () => {
      if (!host) return
      await started
      await host.shutdown()
      host = null
      started = null
    },
  }
}

export const taskflowHostModule: HostModule = createTaskflowHostModule()
