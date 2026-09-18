// What a Server Component reads.
//
// A page calls these directly. It never fetches the API this process is already
// serving: the request would leave the process, come back through the same
// dispatcher, and pay for a round trip to reach code the render already has.
//
// Every one of them takes the principal and applies the same scope the API
// applies, from the same helpers. A page that could see more than the API would
// return is a page that leaks; a page that has to remember to filter is a page
// that will forget.

import { authorize, Forbidden, type Principal } from 'portta-auth-core'
import type { ActivityEvent, Project, ProjectSummary, Repository, Session } from 'portta-contracts'
import { requireDatabase } from '../db/index.ts'
import type { AppDeps } from '../deps.ts'
import { projectScope, visible } from './access-control.ts'
import { activityView, loadNames, sessionView } from './activity-view.ts'
import { loadProjectCatalog, toProject, toProjectSummary } from './catalog.ts'
import { loadScans, toRepository } from './repositories.ts'

/** A page asking for something that is not there, said the way `notFound()` reads. */
export class NotVisible extends Error {
  constructor(what: string) {
    super(what)
    this.name = 'NotVisible'
  }
}

/**
 * The Project a page is about, or nothing.
 *
 * `null` for both "no such Project" and "not yours", deliberately: a page that
 * answered differently would say which slugs exist to somebody who may not see
 * them, and the page renders a 404 either way.
 */
export async function readProject(deps: AppDeps, principal: Principal, slug: string): Promise<Project | null> {
  const db = requireDatabase(deps.db)
  const record = await db.projects.find(slug)
  if (!record) return null
  try {
    authorize(principal, 'project:read', { projectId: projectScope(record.id) })
  } catch (error) {
    if (error instanceof Forbidden) return null
    throw error
  }
  const catalog = await loadProjectCatalog(db, await deps.cache.get(), deps.config)
  return toProject(
    record,
    catalog.repositoriesByProject.get(record.id) ?? [],
    catalog.environments.get(record.id) ?? [],
    deps.config.projectsHome,
  )
}

/** Every Project this principal can open. */
export async function readProjects(deps: AppDeps, principal: Principal): Promise<ProjectSummary[]> {
  const db = requireDatabase(deps.db)
  const catalog = await loadProjectCatalog(db, await deps.cache.get(), deps.config)
  const summaries = catalog.records.map((record) =>
    toProjectSummary(
      record,
      (catalog.repositoriesByProject.get(record.id) ?? []).length,
      catalog.environments.get(record.id) ?? [],
    ),
  )
  return visible(principal, summaries, (summary) => projectScope(summary.id))
}

export async function readRepositories(deps: AppDeps, principal: Principal, slug: string): Promise<Repository[]> {
  const db = requireDatabase(deps.db)
  const project = await readProject(deps, principal, slug)
  if (!project) return []
  const scans = loadScans(deps.config)
  const rows = await db.repositories.list(project.id)
  return rows.map((row) => toRepository(deps.config, row, scans))
}

export async function readRepository(deps: AppDeps, principal: Principal, id: string): Promise<Repository | null> {
  const db = requireDatabase(deps.db)
  const row = await db.repositories.find(id)
  if (!row) return null
  try {
    authorize(principal, 'repository:read', { projectId: projectScope(row.projectId) })
  } catch (error) {
    if (error instanceof Forbidden) return null
    throw error
  }
  return toRepository(deps.config, row, loadScans(deps.config))
}

export async function readActivity(
  deps: AppDeps,
  principal: Principal,
  query: { projectId?: string; issueRef?: string; limit?: number } = {},
): Promise<ActivityEvent[]> {
  const db = requireDatabase(deps.db)
  const rows = await db.activity.list({ limit: 50, ...query })
  const names = await loadNames(db)
  return visible(principal, rows, (row) => projectScope(row.projectId)).map((row) => activityView(names, row))
}

export async function readSessions(
  deps: AppDeps,
  principal: Principal,
  query: { projectId?: string; issueRef?: string; status?: ('active' | 'ended' | 'abandoned')[]; limit?: number } = {},
): Promise<Session[]> {
  const db = requireDatabase(deps.db)
  const rows = await db.sessions.list({ limit: 50, ...query })
  const names = await loadNames(db)
  return visible(principal, rows, (row) => projectScope(row.projectId)).map((row) => sessionView(names, row))
}
