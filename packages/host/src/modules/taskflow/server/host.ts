import { existsSync } from 'node:fs'
import type { Hono } from 'hono'
import { projectPaths } from 'portta-core/taskflow/paths'
import { projectRoot } from '../adapters/config.ts'
import { canonicalizeFsPath } from '../adapters/git.ts'
import type { ProjectsRegistry } from '../adapters/projects-registry.ts'
import { log } from '../lib/log.ts'
import { createTaskflowRuntime } from '../runtime.ts'
import { assertProjectRootAllowed } from '../services/project-allowlist.ts'
import { ProjectInitTracker } from '../services/project-init-service.ts'
import { type ProjectLoopController, ProjectManager } from '../services/project-manager.ts'
import { createTaskflowHostApp } from './app.ts'
import { createHostProjects, type HostProjects, isGitRepo } from './host-projects.ts'
import { createProjectApp, type ProjectApp, type ProjectHost } from './project-app.ts'
import { agentsSocketRoute } from './ws/agents.ts'
import { ProjectSockets } from './ws/sockets.ts'
import { terminalSocketRoute } from './ws/terminal.ts'
import { type ProjectSocketRoute, projectSocketRoutes } from './ws/upgrade.ts'

export interface TaskflowHostOptions {
  /** What every Project app shares, including the port the host listens on. */
  projectHost: ProjectHost
  registry: ProjectsRegistry
  /** Roots a Project may be registered under. */
  projectAllowlist: string[]
  /** Whether a request carries the host daemon's Bearer token. */
  hasValidToken(request: Request): Promise<boolean>
}

/** Every known Project gets its own runtime and app, served under its prefix by
 *  one HTTP app and one set of WebSocket routes the host daemon mounts. */
export interface TaskflowHost {
  app: Hono
  /** `/:prefix/…` socket routes, below the module's socket mount. */
  sockets: ProjectSocketRoute[]
  projects: HostProjects
  /** Load the persisted Projects, plus the repository at `cwd` when it has a Taskflow config. */
  loadProjects(cwd: string): void
  /** Close every socket, stop every Project's loops and wind its Runs down. */
  shutdown(): Promise<void>
}

export function createTaskflowHost(options: TaskflowHostOptions): TaskflowHost {
  const apps = new Map<string, ProjectApp>()
  const manager: ProjectManager = new ProjectManager({
    registry: options.registry,
    port: options.projectHost.port,
    resolveRoot: (path) => canonicalizeFsPath(projectRoot(path)),
    assertAllowed: (root) => assertProjectRootAllowed(root, options.projectAllowlist),
    createRuntime: ({ projectDir, port, prefix }) => createTaskflowRuntime({ projectDir, port, prefix }),
    createLoops: (project): ProjectLoopController => {
      const app = createProjectApp(project.runtime, project.prefix, options.projectHost)
      apps.set(project.prefix, app)
      return {
        startLight: (): void => app.startLight(),
        stopLight: (): void => {
          app.stopLight()
          apps.delete(project.prefix)
        },
        startHeavy: (): void => {},
        stopHeavy: (): void => {},
      }
    },
  })
  const sockets = new ProjectSockets((prefix, active) => manager.setActive(prefix, active))
  const projects = createHostProjects({
    manager,
    apps,
    allowlist: options.projectAllowlist,
    // Backs the project-setup status listing. Registration itself does not
    // scaffold or launch an agent; `taskflow init` is the authoring path.
    initTracker: new ProjectInitTracker(),
    closeSockets: (prefix) => sockets.closeProject(prefix),
  })

  return {
    app: createTaskflowHostApp({ projects, hasValidToken: options.hasValidToken }),
    sockets: projectSocketRoutes([agentsSocketRoute, terminalSocketRoute], { projects: apps, sockets }),
    projects,
    loadProjects(cwd) {
      manager.loadPersisted()
      // The cwd auto-add is in-memory only (not persisted): with one shared
      // `projects.json`, persisting it would make every other running server
      // reload — and double-serve — this repo on its next restart. Only an
      // explicit `taskflow project add` persists.
      if (!isGitRepo(cwd)) return
      const repoRoot = canonicalizeFsPath(projectRoot(cwd))
      const paths = projectPaths(repoRoot)
      if (!existsSync(paths.config) && !existsSync(paths.localConfig)) return
      try {
        manager.addEphemeral(repoRoot)
      } catch (err: unknown) {
        log.error(`[serve] failed to auto-add project ${repoRoot}: ${String(err)}`)
      }
    },
    async shutdown() {
      sockets.closeAll()
      const running = [...apps.values()]
      await Promise.allSettled(running.map((app) => app.shutdownRuns()))
      manager.stopAll()
    },
  }
}
