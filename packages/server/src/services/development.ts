// The Overview, composed.
//
// `GET /api/overview/development` and the panel's Overview page ask for the
// same thing, and neither is allowed to be the place it is assembled: a Server
// Component that fetched its own API would leave the process to reach code it
// already has, and a route handler that assembled it would be the only way to
// get it.
//
// Nothing here is a new source of truth. It reads what the others already read
// (the snapshot, the catalog, the metrics) and hands it to a pure presenter,
// where the shape is tested.

import type { Principal } from 'portta-auth-core'
import type { DevelopmentOverview, Project } from 'portta-contracts'
import type { Database } from '../db/index.ts'
import type { AppDeps } from '../deps.ts'
import { adoptions, projectScope, visible } from './access-control.ts'
import { loadProjectCatalog, toProject } from './catalog.ts'
import { diagnose, problemsOnly } from './diagnostics.ts'
import { gatewayStatus } from './gateway.ts'
import { readCurrentMetrics } from './metrics.ts'
import { aliasViewFor, applyOverrides, loadAliases, loadOverrides } from './overrides.ts'
import { buildOverview } from './overview-view.ts'
import { listShares } from './shares.ts'

/** Every Project the operator has, with the environments it holds. */
export async function listProjects(deps: AppDeps, db: Database): Promise<Project[]> {
  const snapshot = await deps.cache.get()
  const catalog = await loadProjectCatalog(db, snapshot, deps.config)
  return catalog.records.map((record) =>
    toProject(record, catalog.environments.get(record.id) ?? [], catalog.projectsHome),
  )
}

/**
 * The Overview, for one principal.
 *
 * It sums what that person can see and nothing else: a developer's Overview is
 * their Projects and their environments. Totals that included a Project they
 * cannot open would be a number they could not explain. With persistence
 * unreachable it still answers: the gateway's own status and nothing invented.
 */
export async function developmentOverview(deps: AppDeps, principal: Principal): Promise<DevelopmentOverview> {
  const snapshot = await deps.cache.get()
  const overrides = await loadOverrides(deps.db)
  const owners = await adoptions(deps.db)
  const environments = visible(
    principal,
    applyOverrides(snapshot.environments, overrides, aliasViewFor(deps.config)),
    (environment) => owners.get(environment.name) ?? null,
  )
  const metrics = readCurrentMetrics(deps.config)
  const shares = listShares(deps.config, snapshot)
  const gateway = gatewayStatus(snapshot, deps.config)
  const problems = problemsOnly(
    diagnose(snapshot, deps.config, null, shares, deps.db.status(), loadAliases(deps.config)),
  )

  let list: Project[] = []
  if (deps.db.status().available) {
    const db = deps.db
    list = visible(principal, await listProjects(deps, db), (project) => projectScope(project.id))
  }

  return buildOverview({
    now: Date.now(),
    projects: list,
    environments,
    metrics,
    problems,
    gatewayUp: gateway.up,
  })
}
