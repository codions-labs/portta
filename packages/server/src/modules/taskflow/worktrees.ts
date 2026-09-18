// The worktrees of a Taskflow Project, read from the daemon for the panel's
// own use.
//
// The proxy forwards a browser's request one to one; this is the other way the
// panel reaches the daemon, with its own token, to fold an answer into a read
// model it serves — here, the Development Context. Nothing is cached and
// nothing is written: a daemon that does not answer makes the worktrees
// unknown, which the caller reports as such rather than as "none".

import type { PanelConfig } from '../../config.ts'
import { readHostToken } from '../proxy.ts'

export interface TaskflowWorktree {
  /** The directory the Taskflow Project serves; the repository it belongs to on the panel's side. */
  directory: string
  path: string
  branch: string
  base: string | null
  environmentId: string | null
}

export interface TaskflowWorktrees {
  /** False when the daemon could not be asked, or answered with something else. */
  reachable: boolean
  worktrees: TaskflowWorktree[]
}

async function readJson(
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>,
  path: string,
  request: typeof fetch,
): Promise<unknown | null> {
  const token = readHostToken(config.hostTokenFile)
  if (!config.hostUrl || !token) return null
  let response: Response
  try {
    response = await request(`${config.hostUrl.replace(/\/+$/, '')}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  return response.json().catch(() => null)
}

export interface TaskflowRegistry {
  reachable: boolean
  projects: Array<{ prefix: string; path: string }>
}

/**
 * The daemon's registry, with whether it answered. `fetchTaskflowProjects` in
 * scope.ts folds "did not answer" into an empty list, which is the right
 * reading for a scope; a read model that will say "the worktrees are unknown"
 * needs to keep the two apart.
 */
export async function readTaskflowRegistry(
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>,
  request: typeof fetch = fetch,
): Promise<TaskflowRegistry> {
  const body = (await readJson(config, '/api/modules/taskflow/api/projects', request)) as { projects?: unknown } | null
  if (!body || !Array.isArray(body.projects)) return { reachable: false, projects: [] }
  const projects = body.projects.flatMap((entry: unknown) => {
    const candidate = entry as { prefix?: unknown; path?: unknown } | null
    return typeof candidate?.prefix === 'string' && typeof candidate.path === 'string'
      ? [{ prefix: candidate.prefix, path: candidate.path }]
      : []
  })
  return { reachable: true, projects }
}

/** The active worktrees a Taskflow Project has, or `reachable: false` when the daemon did not say. */
export async function fetchTaskflowWorktrees(
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>,
  project: { prefix: string; path: string },
  request: typeof fetch = fetch,
): Promise<TaskflowWorktrees> {
  const body = (await readJson(
    config,
    `/api/modules/taskflow/${encodeURIComponent(project.prefix)}/api/worktrees`,
    request,
  )) as { worktrees?: unknown } | null
  if (!body || !Array.isArray(body.worktrees)) return { reachable: false, worktrees: [] }
  const worktrees = body.worktrees.flatMap((entry: unknown): TaskflowWorktree[] => {
    const candidate = entry as {
      path?: unknown
      branch?: unknown
      baseBranch?: unknown
      environmentId?: unknown
      archived?: unknown
    } | null
    if (typeof candidate?.path !== 'string' || typeof candidate.branch !== 'string' || candidate.archived === true)
      return []
    return [
      {
        directory: project.path,
        path: candidate.path,
        branch: candidate.branch,
        base: typeof candidate.baseBranch === 'string' && candidate.baseBranch !== '' ? candidate.baseBranch : null,
        environmentId: typeof candidate.environmentId === 'string' ? candidate.environmentId : null,
      },
    ]
  })
  return { reachable: true, worktrees }
}
