// Where Taskflow's pages live in the panel, and which one a path is.
//
// Every page is under a Portta Project: `/projects/<slug>/worktrees`, `…/runs`
// and `…/workflows` are its tabs, and `…/taskflow/settings` is the module's
// own settings. Build hrefs here; never by hand.

export type TaskflowSection = 'worktrees' | 'runs' | 'workflows' | 'settings'

export interface TaskflowPaths {
  project: () => string
  worktrees: () => string
  worktree: (name: string) => string
  runs: () => string
  run: (id: string) => string
  workflows: () => string
  workflow: (id: string) => string
  settings: () => string
}

export function taskflowPaths(slug: string): TaskflowPaths {
  const base = `/projects/${encodeURIComponent(slug)}`
  return {
    project: () => base,
    worktrees: () => `${base}/worktrees`,
    worktree: (name) => `${base}/worktrees/${encodeURIComponent(name)}`,
    runs: () => `${base}/runs`,
    run: (id) => `${base}/runs/${encodeURIComponent(id)}`,
    workflows: () => `${base}/workflows`,
    workflow: (id) => `${base}/workflows/${encodeURIComponent(id)}`,
    settings: () => `${base}/taskflow/settings`,
  }
}

/** The module's guide to these pages, in the panel's documentation. */
export const TASKFLOW_DOCS = '/docs/taskflow/dashboard'

export interface TaskflowLocation {
  section: TaskflowSection | null
  /** The worktree, Run or workflow the path names, decoded. */
  id: string | null
}

function decoded(segment: string | undefined): string | null {
  if (!segment) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** A route parameter as it was named, whether or not the router already decoded it. */
export function routeParam(value: string): string {
  return decoded(value) ?? value
}

/** `/projects/shop/worktrees/feature%2Flogin` is the worktrees section, on `feature/login`. */
export function taskflowLocation(pathname: string, slug: string): TaskflowLocation {
  const base = `/projects/${encodeURIComponent(slug)}/`
  if (!pathname.startsWith(base)) return { section: null, id: null }
  const [first, second] = pathname.slice(base.length).split('/')
  if (first === 'taskflow' && second === 'settings') return { section: 'settings', id: null }
  if (first === 'worktrees' || first === 'runs' || first === 'workflows') return { section: first, id: decoded(second) }
  return { section: null, id: null }
}
