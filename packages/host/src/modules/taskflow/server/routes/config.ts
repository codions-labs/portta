import type { Hono } from 'hono'
import { jsonResponse } from '../../lib/http.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter } from './project-router.ts'

export function configRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchConfig', 'Configuration', (project) => jsonResponse(project.frontendConfig()))

  projectRoute(app, deps, 'fetchDiagnostics', 'Configuration', async (project) =>
    jsonResponse(await project.diagnostics.run()),
  )

  return app
}
