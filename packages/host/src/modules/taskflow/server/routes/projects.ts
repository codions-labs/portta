import { Hono } from 'hono'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { ProjectAllowlistError } from '../../services/project-allowlist.ts'
import type { HostProjects } from '../host-projects.ts'
import { contractRoute } from '../openapi.ts'

export function projectsRoutes(deps: { projects: HostProjects }): Hono {
  const app = new Hono()

  contractRoute(app, 'fetchProjects', 'Projects', () => jsonResponse({ projects: deps.projects.list() }))

  contractRoute(app, 'addProject', 'Projects', (_c, { body }) => {
    if (body.path.trim() === '') return errorResponse('Request body must be { path: string }', 400)
    try {
      const registered = deps.projects.register(body.path.trim())
      return jsonResponse({ initializing: false, ...registered })
    } catch (error: unknown) {
      if (error instanceof ProjectAllowlistError) return errorResponse(error.message, 403)
      return errorResponse(error instanceof Error ? error.message : String(error), 400)
    }
  })

  contractRoute(app, 'projectInits', 'Projects', () => jsonResponse({ inits: deps.projects.inits() }))

  contractRoute(app, 'removeProject', 'Projects', (_c, { params }) =>
    deps.projects.remove(params.prefix) ? jsonResponse({ ok: true }) : errorResponse('Project not found', 404),
  )

  return app
}
