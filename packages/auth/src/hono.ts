// The API's half of authorisation.
//
// Two middlewares: one that decides who is asking, once per request, and one a
// route attaches to say what it needs. Nothing else in the API layer talks to
// this package.

import type { Context, MiddlewareHandler } from 'hono'
import type { Permission } from './access-control.ts'
import { authorize, type Principal, Unauthenticated } from './authorize.ts'
import type { PrincipalResolver } from './principal.ts'

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal
    /**
     * What the route declared it needs. Set by `documentRoute` so the scope
     * check later in the handler asks about the same permission the door did,
     * instead of naming it a second time and drifting from it.
     */
    permission: Permission
  }
}

export interface PrincipalMiddlewareOptions {
  resolver: PrincipalResolver
  /**
   * `METHOD /path` for the routes that answer without a credential: liveness,
   * the auth status, and the setup endpoint while it is still open.
   */
  publicRoutes: ReadonlySet<string>
  /** Whether the panel is still waiting for its first user. */
  setupRequired?: () => Promise<boolean>
}

export class SetupRequired extends Error {
  readonly status = 503

  constructor() {
    super('this panel has no owner yet; open /setup')
    this.name = 'SetupRequired'
  }
}

export function principalMiddleware(options: PrincipalMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = `${c.req.method} ${c.req.path}`
    if (options.publicRoutes.has(key)) return next()

    // A panel with no owner answers nothing but the three public routes: every
    // other answer would be about a host nobody has proved they may see.
    if (options.setupRequired && (await options.setupRequired())) throw new SetupRequired()

    const principal = await options.resolver.fromHeaders(c.req.raw.headers)
    if (!principal) throw new Unauthenticated()
    c.set('principal', principal)
    await next()
  }
}

export function principalOf(c: Context): Principal {
  const principal = c.get('principal')
  if (!principal) throw new Unauthenticated()
  return principal
}

/**
 * The other half of the decision, once the resource is known.
 *
 * The route said what it needs before the handler ran; this says which Project
 * the thing it just read belongs to. A `developer` holding `issue:write` still
 * may not write an issue in a Project nobody put them in.
 *
 * `null` means a resource no Project adopted — an environment running on the
 * host that nothing claims. Those are visible only to somebody who sees
 * everything, because there is no membership to check.
 */
export function authorizeScope(c: Context, projectId: number | null): Principal {
  const permission = c.get('permission')
  // A route with no declared permission is public, and a public route has no
  // scope to narrow. Reaching here from one is a mistake worth saying out loud.
  if (!permission) throw new Error('authorizeScope was called from a route that declares no permission')
  return authorize(c.get('principal') ?? null, permission, { projectId })
}
