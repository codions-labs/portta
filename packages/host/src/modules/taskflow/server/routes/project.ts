import type { Hono } from 'hono'
import { jsonResponse } from '../../lib/http.ts'
import { touchDashboardActivity } from '../../services/dashboard-activity.ts'
import { type ProjectRouteDeps, projectRoute, projectRouter } from './project-router.ts'

export function projectSnapshotRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'fetchProject', 'Project', async (project) => {
    touchDashboardActivity()
    return jsonResponse(await project.readProjectSnapshot())
  })

  projectRoute(app, deps, 'fetchAutoNameConfig', 'Project', ({ runtime: { config } }) => {
    const apiKey = process.env.LINEAR_API_KEY
    const linearAvailability = !config.integrations.linear.enabled
      ? 'disabled'
      : !apiKey?.trim()
        ? 'missing_api_key'
        : 'ready'
    return jsonResponse({ autoName: config.autoName, linearAvailability })
  })

  return app
}
