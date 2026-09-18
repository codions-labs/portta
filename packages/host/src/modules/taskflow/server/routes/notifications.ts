import type { Hono } from 'hono'
import { parseRuntimeEvent } from 'portta-core/taskflow'
import { errorResponse, jsonResponse } from '../../lib/http.ts'
import { describeHostRoute } from '../openapi.ts'
import type { ProjectApp } from '../project-app.ts'
import { type ProjectRouteDeps, projectOf, projectRoute, projectRouter } from './project-router.ts'

async function apiRuntimeEvent(project: ProjectApp, req: Request): Promise<Response> {
  const { projectRuntime, reconciliationService, runtimeNotifications, projectDir } = project.runtime
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return errorResponse('Invalid JSON', 400)
  }
  const event = parseRuntimeEvent(raw)
  if (!event) return errorResponse('Invalid runtime event body', 400)

  try {
    projectRuntime.applyEvent(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Unknown worktree id')) {
      await reconciliationService.reconcile(projectDir)
      try {
        projectRuntime.applyEvent(event)
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
        if (retryMessage.includes('Unknown worktree id')) {
          return errorResponse(retryMessage, 404)
        }
        throw retryError
      }
    } else {
      throw error
    }
  }

  const notification = runtimeNotifications.recordEvent(event)
  return jsonResponse({
    ok: true,
    ...(notification ? { notification } : {}),
  })
}

export function notificationRoutes(deps: ProjectRouteDeps): Hono {
  const app = projectRouter()

  projectRoute(app, deps, 'dismissNotification', 'Notifications', ({ runtime }, { params }) =>
    runtime.runtimeNotifications.dismiss(params.id) ? jsonResponse({ ok: true }) : errorResponse('Not found', 404),
  )

  app.get(
    '/api/notifications/stream',
    describeHostRoute({
      tag: 'Notifications',
      operationId: 'streamNotifications',
      summary: 'Follow runtime notifications as server-sent events',
      mediaType: 'text/event-stream',
      responses: [200, 404],
    }),
    (c) => {
      const project = projectOf(deps, c)
      return project instanceof Response ? project : project.runtime.runtimeNotifications.stream()
    },
  )

  // Agent hooks report here with the control token, even on a loopback bind.
  app.post(
    '/api/runtime/events',
    describeHostRoute({
      tag: 'Notifications',
      operationId: 'postRuntimeEvent',
      summary: 'Report a runtime event from an agent hook',
      responses: [200, 400, 401, 404],
    }),
    async (c) => {
      if (!(await deps.hasValidToken(c.req.raw))) return c.text('Unauthorized', 401)
      const project = projectOf(deps, c)
      return project instanceof Response ? project : apiRuntimeEvent(project, c.req.raw)
    },
  )

  return app
}
