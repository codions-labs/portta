import type { ProjectEntry } from 'portta-core/taskflow'
import { deriveProjectPrefix } from 'portta-core/taskflow'
import { projectRoot } from '../adapters/config.ts'
import { sameFsPath } from '../adapters/git.ts'
import type { ProjectsRegistry } from '../adapters/projects-registry.ts'
import { log } from '../lib/log.ts'
import type { TaskflowRuntime } from '../runtime.ts'

/** The minimum a per-project runtime must expose for the manager to label it.
 *  `TaskflowRuntime` satisfies this; tests can supply a lighter stub. */
export interface RuntimeLike {
  config: { name: string }
}

export interface ManagedProject<R extends RuntimeLike = TaskflowRuntime> {
  /** URL-path prefix and stable in-process id for this project. */
  prefix: string
  entry: ProjectEntry
  runtime: R
  /** Whether a client currently has this project open (drives heavy loops). */
  active: boolean
}

/** Background work for one project, split into the two liveness tiers:
 *  light loops (PR/CI poll, Linear auto-create, auto-pull) run for every known
 *  project; heavy loops (reconciliation cadence, attach) run only while active. */
export interface ProjectLoopController {
  startLight(): void
  stopLight(): void
  startHeavy(): void
  stopHeavy(): void
}

const NOOP_LOOPS: ProjectLoopController = {
  startLight(): void {},
  stopLight(): void {},
  startHeavy(): void {},
  stopHeavy(): void {},
}

export interface ProjectManagerDeps<R extends RuntimeLike = TaskflowRuntime> {
  registry: ProjectsRegistry
  /** The single server port shared by every project. */
  port: number
  /** Build the per-project runtime — pass `createTaskflowRuntime` in production.
   *  `R` is inferred from the return type, so tests can supply a typed stub. */
  createRuntime: (options: { projectDir: string; port: number; prefix: string }) => R
  /** Resolve an arbitrary path to its canonical project (git) root. */
  resolveRoot?: (path: string) => string
  /** Refuse registration when the canonical root is outside the allowlist. */
  assertAllowed?: (root: string) => void
  /** Build the loop controller for a project. Defaults to a no-op (wired in
   *  Stage 2); tests inject a spy. */
  createLoops?: (project: ManagedProject<R>) => ProjectLoopController
}

/** Owns the set of projects served by a single taskflow process: one runtime per
 *  project, keyed by URL prefix, plus the registry that persists which projects
 *  are known across restarts. */
export class ProjectManager<R extends RuntimeLike = TaskflowRuntime> {
  private readonly registry: ProjectsRegistry
  private readonly port: number
  private readonly resolveRoot: (path: string) => string
  private readonly assertAllowed: ((root: string) => void) | undefined
  private readonly createRuntime: (options: { projectDir: string; port: number; prefix: string }) => R
  private readonly createLoops: (project: ManagedProject<R>) => ProjectLoopController
  private readonly projects = new Map<string, ManagedProject<R>>()
  private readonly loops = new Map<string, ProjectLoopController>()

  constructor(deps: ProjectManagerDeps<R>) {
    this.registry = deps.registry
    this.port = deps.port
    this.createRuntime = deps.createRuntime
    this.resolveRoot = deps.resolveRoot ?? projectRoot
    this.assertAllowed = deps.assertAllowed
    this.createLoops = deps.createLoops ?? ((): ProjectLoopController => NOOP_LOOPS)
  }

  list(): ManagedProject<R>[] {
    return [...this.projects.values()]
  }

  getByPrefix(prefix: string): ManagedProject<R> | null {
    return this.projects.get(prefix) ?? null
  }

  getByPath(path: string): ManagedProject<R> | null {
    return this.findByRoot(this.resolveRoot(path))
  }

  /** Load every persisted project. Entries that fail to resolve or whose config
   *  cannot be loaded are skipped (logged), not fatal. Does not re-persist. */
  loadPersisted(): void {
    for (const entry of this.registry.list()) {
      try {
        this.register(entry.path, false)
      } catch (err: unknown) {
        log.error(`[project-manager] failed to load ${entry.path}: ${String(err)}`)
      }
    }
  }

  /** Add (or return the existing) project for `path`, persisting it to the
   *  registry so it is reloaded on the next start. */
  add(path: string): ManagedProject<R> {
    return this.register(path, true)
  }

  /** Add (or return the existing) project for `path` for this process only,
   *  without persisting it to the registry. Used for the cwd auto-add on
   *  `serve`: the repo is served for this session but never written to the
   *  shared `~/.portta/state/host/projects.json`, so other running servers don't pick it
   *  up (and cross-serve it) on their next restart. Only `add()` persists. */
  addEphemeral(path: string): ManagedProject<R> {
    return this.register(path, false)
  }

  remove(prefix: string): void {
    const project = this.projects.get(prefix)
    if (!project) return
    const controller = this.loops.get(prefix)
    controller?.stopHeavy()
    controller?.stopLight()
    this.projects.delete(prefix)
    this.loops.delete(prefix)
    this.registry.remove(project.entry.path)
  }

  /** Stop every project's loops and forget them, leaving the registry as it is:
   *  the process is going away, not the projects. */
  stopAll(): void {
    for (const controller of this.loops.values()) {
      controller.stopHeavy()
      controller.stopLight()
    }
    this.projects.clear()
    this.loops.clear()
  }

  /** Mark a project active/idle. Toggling starts/stops its heavy loops; light
   *  loops are unaffected and keep running for every known project. */
  setActive(prefix: string, active: boolean): void {
    const project = this.projects.get(prefix)
    if (!project || project.active === active) return
    project.active = active
    const controller = this.loops.get(prefix)
    if (active) controller?.startHeavy()
    else controller?.stopHeavy()
  }

  private findByRoot(root: string): ManagedProject<R> | null {
    for (const project of this.projects.values()) {
      if (sameFsPath(project.entry.path, root)) return project
    }
    return null
  }

  private register(path: string, persist: boolean): ManagedProject<R> {
    const root = this.resolveRoot(path)
    this.assertAllowed?.(root)
    const existing = this.findByRoot(root)
    if (existing) {
      if (persist) this.registry.add(existing.entry)
      return existing
    }

    const prefix = deriveProjectPrefix(root, this.projects.keys())
    const runtime = this.createRuntime({ projectDir: root, port: this.port, prefix })
    const entry: ProjectEntry = {
      path: root,
      name: runtime.config.name,
      addedAt: Date.now(),
    }
    const project: ManagedProject<R> = { prefix, entry, runtime, active: false }
    this.projects.set(prefix, project)

    const controller = this.createLoops(project)
    this.loops.set(prefix, controller)
    controller.startLight()

    if (persist) this.registry.add(entry)
    return project
  }
}
