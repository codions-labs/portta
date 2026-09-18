import type { Hono } from 'hono'
import { jsonResponse } from '../../lib/http.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter } from './project-router.ts'

export function branchRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchAvailableBranches', 'Branches', ({ runtime }, { query }) =>
    jsonResponse({
      branches: runtime.lifecycleService.listAvailableBranches({ includeRemote: query.includeRemote === true }),
    }),
  )

  projectRoute(app, deps, 'fetchBaseBranches', 'Branches', ({ runtime }) =>
    jsonResponse({ branches: runtime.lifecycleService.listBaseBranches() }),
  )

  return app
}
