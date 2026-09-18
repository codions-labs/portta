// Which Portta Project a Taskflow prefix is.
//
// Taskflow names a Project by a URL prefix the daemon chose and a directory on
// the host; Portta names one by its row, and a project-scoped role is a list of
// those rows. The two meet at the directory: a Taskflow Project is the Portta
// Project whose own directory, or one of whose repositories, is the directory
// Taskflow serves.
//
// A prefix no Portta Project claims is `{ projectId: null }`, the scope Portta
// already gives an environment nothing adopted: somebody who sees every Project
// reaches it, and a member of some Projects does not. Refusing a scoped member
// is the safe answer to "whose is this?" when the answer is "nobody's yet".

import { posix } from 'node:path'
import { type Principal, type Scope, sees } from 'portta-auth-core'
import type { PanelConfig } from '../../config.ts'
import { requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope } from '../../services/access-control.ts'
import { resolvedPathOf } from '../../services/catalog.ts'
import { readHostToken } from '../proxy.ts'

export interface TaskflowProjectDirectory {
  prefix: string
  path: string
}

export interface RepositoryLocation {
  localPath: string | null
  relativePath: string | null
}

function normalized(path: string): string {
  const clean = posix.normalize(path.trim()).replace(/\/+$/, '')
  return clean === '' ? '/' : clean
}

/**
 * Every directory on the host that is a Portta Project's: its own, each
 * repository's registered path, and each repository's place inside it.
 */
export function projectHostPaths(resolvedPath: string | null, repositories: readonly RepositoryLocation[]): string[] {
  const paths = [resolvedPath]
  for (const repository of repositories) {
    paths.push(repository.localPath)
    if (resolvedPath && repository.relativePath) paths.push(posix.join(resolvedPath, repository.relativePath))
  }
  return [
    ...new Set(
      paths.filter((path): path is string => typeof path === 'string' && path.startsWith('/')).map(normalized),
    ),
  ]
}

/** Whether a Taskflow directory is one of a Project's. */
export function servesPath(hostPaths: readonly string[], directory: string): boolean {
  return directory.startsWith('/') && hostPaths.includes(normalized(directory))
}

/** The Taskflow Projects the daemon serves, read with its token. */
export async function fetchTaskflowProjects(
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>,
  request: typeof fetch = fetch,
): Promise<TaskflowProjectDirectory[]> {
  const token = readHostToken(config.hostTokenFile)
  if (!config.hostUrl || !token) return []
  const response = await request(`${config.hostUrl.replace(/\/+$/, '')}/api/modules/taskflow/api/projects`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) return []
  const body = (await response.json()) as { projects?: unknown }
  if (!Array.isArray(body.projects)) return []
  return body.projects.flatMap((entry: unknown) => {
    const candidate = entry as Partial<TaskflowProjectDirectory> | null
    return typeof candidate?.prefix === 'string' && typeof candidate.path === 'string'
      ? [{ prefix: candidate.prefix, path: candidate.path }]
      : []
  })
}

export interface TaskflowScopes {
  scopeOf(prefix: string | undefined): Promise<Scope>
}

export interface TaskflowScopeOptions {
  deps: Pick<AppDeps, 'db' | 'config'>
  /** The daemon's registry; `fetchTaskflowProjects` outside a suite. */
  projects: () => Promise<TaskflowProjectDirectory[]>
  /** How long one answer is reused. Every forwarded request asks, and a page makes several at once. */
  ttlMs?: number
  now?: () => number
}

/**
 * Prefix to scope, remembered briefly.
 *
 * The map is rebuilt from the registry and the database at most once per
 * `ttlMs`, so a burst of requests from one page costs one read of each. A daemon
 * that cannot be read gives an empty map, which scopes every prefix to nobody's:
 * the request that follows would fail to reach it anyway.
 */
export function createTaskflowScopes(options: TaskflowScopeOptions): TaskflowScopes {
  const ttl = options.ttlMs ?? 5_000
  const now = options.now ?? Date.now
  let cached: { at: number; map: Promise<Map<string, number>> } | null = null

  async function build(): Promise<Map<string, number>> {
    const [directories, records, repositories] = await Promise.all([
      options.projects().catch((): TaskflowProjectDirectory[] => []),
      options.deps.db.projects.list(),
      options.deps.db.repositories.list(),
    ])
    const owners = records.map((record) => ({
      id: projectScope(record.id),
      paths: projectHostPaths(
        resolvedPathOf(options.deps.config.projectsHome, record.relativePath),
        repositories.filter((repository) => repository.projectId === record.id),
      ),
    }))
    const map = new Map<string, number>()
    for (const directory of directories) {
      const owner = owners.find((candidate) => candidate.id !== null && servesPath(candidate.paths, directory.path))
      if (owner && owner.id !== null) map.set(directory.prefix, owner.id)
    }
    return map
  }

  return {
    async scopeOf(prefix) {
      if (!cached || now() - cached.at >= ttl) {
        const map = build()
        cached = { at: now(), map }
        // A failed build is not remembered: the next request tries again.
        map.catch(() => {
          if (cached?.map === map) cached = null
        })
      }
      const map = await cached.map
      return { projectId: prefix ? (map.get(prefix) ?? null) : null }
    },
  }
}

export interface ProjectDirectories {
  id: string
  slug: string
  name: string
  hostPaths: string[]
}

/**
 * Every Project this principal can see, with its directories on the host.
 *
 * What a page offers Taskflow for: the registry page names the Portta Project
 * each Taskflow Project is, and a Project page finds its own the same way.
 */
export async function readProjectDirectories(
  deps: Pick<AppDeps, 'db' | 'config'>,
  principal: Principal,
): Promise<ProjectDirectories[]> {
  const db = requireDatabase(deps.db)
  const [records, repositories] = await Promise.all([db.projects.list(), db.repositories.list()])
  return records
    .filter((record) => sees(principal, Number(record.id)))
    .map((record) => ({
      id: record.id,
      slug: record.slug,
      name: record.name,
      hostPaths: projectHostPaths(
        resolvedPathOf(deps.config.projectsHome, record.relativePath),
        repositories.filter((repository) => repository.projectId === record.id),
      ),
    }))
}
