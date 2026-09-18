// One listener for every WebSocket path, and one place that decides.
//
// A handshake is authenticated and authorised *before* it becomes a socket:
// the request still has headers, so the same principal resolver every route
// uses answers the same question here, and a refusal is an HTTP status on a
// socket that is then destroyed. A refused handshake that leaves the socket
// open is a client waiting forever for a server that has already decided.
//
// One listener, not one per route: several `upgrade` listeners on
// one server all receive every upgrade, and the ones that do not recognise the
// path leave the socket hanging unless every one of them agrees who cleans up.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  authorize,
  Forbidden,
  type Permission,
  type Principal,
  type PrincipalResolver,
  type Scope,
} from 'portta-auth-core'
import { matchPath } from 'portta-core'
import type { WebSocket, WebSocketServer } from 'ws'
import { originAllowed } from '../../origin.ts'

export interface WsRoute {
  /** `/ws/environments/:name/logs`. Only `:name`-style segments are matched. */
  path: string
  permission: Permission
  /**
   * Which Project this connection is about, resolved before the upgrade.
   *
   * Returning `undefined` means the route is global; `{ projectId: null }` is a
   * resource no Project adopted, which only `scope: 'all'` reaches. Throwing
   * `NotFound` refuses the handshake with a 404.
   */
  scopeOf: (params: Record<string, string>, url: URL) => Promise<Scope | undefined>
  handle: (socket: WebSocket, context: { params: Record<string, string>; url: URL; principal: Principal }) => void
}

/** The route matched, but the thing it names does not exist. */
export class NotFound extends Error {
  constructor(message = 'not found') {
    super(message)
    this.name = 'NotFound'
  }
}

export { matchPath }

export function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/** Node's headers, as the resolver expects them. */
export function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

export interface UpgradeDeps {
  principals: PrincipalResolver
  routes: WsRoute[]
  server: WebSocketServer
  trustedOrigins?: readonly string[]
}

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean>

/**
 * Handle an upgrade, or say it was not ours.
 *
 * Returns `false` for a path that is not `/ws/…`, so the caller can hand it to
 * whatever else listens — Next's HMR socket in development. Everything under
 * `/ws/` is this handler's, including the paths it refuses.
 */
export function createUpgradeHandler(deps: UpgradeDeps): UpgradeHandler {
  return async (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/ws/')) return false

    try {
      const principal = await deps.principals.fromHeaders(headersOf(request))
      // 401 before 404: an anonymous caller learns whether it needs to sign in,
      // and not which paths exist.
      if (!principal) {
        reject(socket, 401, 'Unauthorized')
        return true
      }

      if (!originAllowed(request.headers.origin ?? '', request.headers.host ?? '', deps.trustedOrigins ?? [])) {
        reject(socket, 403, 'Forbidden')
        return true
      }

      const matched = deps.routes
        .map((route) => ({ route, params: matchPath(route.path, url.pathname) }))
        .find((candidate) => candidate.params !== null)
      if (!matched?.params) {
        reject(socket, 404, 'Not Found')
        return true
      }

      const scope = await matched.route.scopeOf(matched.params, url)
      authorize(principal, matched.route.permission, scope)

      deps.server.handleUpgrade(request, socket, head, (ws) => {
        matched.route.handle(ws, { params: matched.params!, url, principal })
      })
    } catch (cause) {
      if (cause instanceof Forbidden) reject(socket, 403, 'Forbidden')
      else if (cause instanceof NotFound) reject(socket, 404, 'Not Found')
      else reject(socket, 500, 'Internal Server Error')
    }
    return true
  }
}
