import { type Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { apiContract } from 'portta-contracts/taskflow'
import { isValidWorktreeName } from 'portta-core/taskflow'
import { errorResponse } from '../../lib/http.ts'
import { log } from '../../lib/log.ts'
import { LifecycleError } from '../../services/lifecycle-service.ts'
import { type ApiTag, type ContractKey, contractRoute, type RouteInput } from '../openapi.ts'
import type { ProjectApp } from '../project-app.ts'

/** The Projects the host serves right now, by URL prefix. */
export interface ProjectApps {
  get(prefix: string): ProjectApp | undefined
}

export interface ProjectRouteDeps {
  projects: ProjectApps
  /** Whether a request carries the host's Bearer token. */
  hasValidToken(request: Request): Promise<boolean>
}

/** A router for Project routes, mounted by the host under `/:prefix`. A
 *  lifecycle refusal keeps its status; any other failure is logged and answered
 *  with its message. */
export function projectRouter(): Hono {
  const app = new Hono()
  app.onError((error, c) => {
    if (error instanceof LifecycleError) return c.json({ error: error.message }, error.status as ContentfulStatusCode)
    const message = error instanceof Error ? error.message : String(error)
    log.error(`[api:error] ${c.req.method} ${c.req.routePath}: ${message}`)
    return c.json({ error: message }, 500)
  })
  return app
}

/** The Project a request's `/:prefix` names, or a 404 response. */
export function projectOf(deps: ProjectRouteDeps, c: Context): ProjectApp | Response {
  return deps.projects.get(c.req.param('prefix') ?? '') ?? errorResponse('Project not found', 404)
}

export type BodyOf<K extends ContractKey> = RouteInput<(typeof apiContract)[K]>['body']

/** A contract route answered by the Project its `/:prefix` names. */
export function projectRoute<K extends ContractKey>(
  app: Hono,
  deps: ProjectRouteDeps,
  key: K,
  tag: ApiTag,
  handler: (
    project: ProjectApp,
    input: RouteInput<(typeof apiContract)[K]>,
    c: Context,
  ) => Response | Promise<Response>,
): void {
  contractRoute(app, key, tag, (c, input) => {
    const project = projectOf(deps, c)
    return project instanceof Response ? project : handler(project, input, c)
  })
}

/** A worktree name from a path, or the 400 an invalid one gets. */
export function worktreeName(name: string): string | Response {
  return isValidWorktreeName(name) ? name : errorResponse('Invalid worktree name', 400)
}
