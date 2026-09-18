import { spawnSync } from 'node:child_process'
import type { ProjectInitState, ProjectSummary } from 'portta-contracts/taskflow'
import { projectRoot } from '../adapters/config.ts'
import { canonicalizeFsPath } from '../adapters/git.ts'
import { registerableProjectRoot } from '../services/project-allowlist.ts'
import type { ProjectInitTracker } from '../services/project-init-service.ts'
import type { ManagedProject, ProjectManager } from '../services/project-manager.ts'
import type { ProjectApp } from './project-app.ts'
import type { ProjectApps } from './routes/project-router.ts'

/** Strict check: is `dir` itself inside a git work tree? Unlike
 *  git.resolveRepoRoot it never scans child directories, so a non-repo path is
 *  rejected rather than silently resolving to an unrelated nested repo. */
export function isGitRepo(dir: string): boolean {
  try {
    return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/** The Projects a host serves: the global routes read and change this set. */
export interface HostProjects extends ProjectApps {
  list(): ProjectSummary[]
  /** Register the git repository at `path` (or return the one already registered).
   *  Throws `ProjectAllowlistError` outside the allowlist, `Error` for anything else. */
  register(path: string): { path: string; project: ProjectSummary }
  /** Close the Project's sockets and stop serving it; `false` when it is unknown. */
  remove(prefix: string): boolean
  inits(): ProjectInitState[]
}

export interface HostProjectsDeps {
  manager: ProjectManager
  apps: ReadonlyMap<string, ProjectApp>
  allowlist: string[]
  initTracker: ProjectInitTracker
  closeSockets(prefix: string): void
}

function toProjectSummary(project: ManagedProject): ProjectSummary {
  return { prefix: project.prefix, name: project.entry.name, path: project.entry.path, active: project.active }
}

export function createHostProjects(deps: HostProjectsDeps): HostProjects {
  return {
    get: (prefix) => deps.apps.get(prefix),
    list: () => deps.manager.list().map(toProjectSummary),
    register(path) {
      const root = registerableProjectRoot(path, {
        isGitRepo,
        resolveRoot: (candidate) => canonicalizeFsPath(projectRoot(candidate)),
        allowlist: deps.allowlist,
      })
      // Register only. Do not write `.portta/taskflow.yaml` or spawn an agent/workflow;
      // operators author config with `taskflow init` when they want it.
      const project = deps.manager.getByPath(root) ?? deps.manager.add(root)
      return { path: root, project: toProjectSummary(project) }
    },
    remove(prefix) {
      if (!deps.apps.has(prefix)) return false
      // Sockets first: their cleanup (tmux detach, agents unsubscribe) needs the
      // Project app, which the manager drops when it stops the Project.
      deps.closeSockets(prefix)
      deps.manager.remove(prefix)
      return true
    },
    inits: () =>
      deps.initTracker.list().map((state) => ({
        path: state.path,
        phase: state.phase,
        prefix: state.prefix,
        name: state.name,
        error: state.error,
      })),
  }
}
