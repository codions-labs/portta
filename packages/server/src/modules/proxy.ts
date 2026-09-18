// The panel's authorised way to a module that runs on the host.
// See docs/development/adr/0047-host-daemon-and-panel-proxy.md.
//
// The panel cannot run git, tmux or an agent: it is a container with none of
// them and no project directory (ADR 0001, 0030). A module that needs those
// runs its routes in the host daemon instead, and the panel forwards to it.
// The forwarding is where Portta's authorisation stays: every route is named in
// a table with the permission it needs, a request the table does not name is a
// 404 without the daemon ever seeing it, and the daemon's token is added here,
// never by the browser.
//
// Bodies are streams in both directions, so an upload is not buffered and a
// server-sent event reaches the browser when the daemon writes it.

import { readFileSync } from 'node:fs'
import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorize, type Permission, type Principal, type Scope } from 'portta-auth-core'
import { principalOf } from 'portta-auth-core/hono'
import { matchPath } from 'portta-core'
import { WebSocket } from 'ws'
import type { PanelConfig } from '../config.ts'
import type { WsRoute } from '../realtime/ws/upgrade.ts'

export type ProxyMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ProxyRoute {
  method: ProxyMethod
  /** Below the module's root, such as `/runs/:id/events`. A trailing `*` matches the rest. */
  pattern: string
  permission: Permission
  /** Which Project the request is about, once its parameters are known. Absent means global. */
  scopeOf?: (params: Record<string, string>, c: Context) => Scope | undefined | Promise<Scope | undefined>
}

export type RoutePermissionTable = readonly ProxyRoute[]

export interface HostProxyOptions {
  moduleId: string
  routes: RoutePermissionTable
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>
  /** For a suite; the process's own `fetch` otherwise. */
  fetch?: typeof fetch
}

/** Hop-by-hop, the caller's own credentials, and anything that claims to be Portta. */
const DROPPED_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'authorization',
  'cookie',
  'content-length',
])
/** The daemon sets no cookie of the panel's, and `fetch` has already decoded the body. */
const DROPPED_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'content-encoding',
  'content-length',
])

/**
 * The token, read when it is needed rather than at boot.
 *
 * The file is created by the daemon, possibly after the panel started, and it
 * is a few bytes: reading it per request costs nothing next to the request.
 */
export function readHostToken(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim() || null
  } catch {
    return null
  }
}

function hostTarget(config: HostProxyOptions['config']): { url: string; token: string } {
  if (!config.hostUrl) {
    throw new HTTPException(503, { message: 'the host daemon is not configured: set PORTTA_HOST_URL' })
  }
  const token = readHostToken(config.hostTokenFile)
  if (!token) {
    throw new HTTPException(503, {
      message: `the host daemon token is not readable at ${config.hostTokenFile}; start it with portta host serve`,
    })
  }
  return { url: config.hostUrl.replace(/\/+$/, ''), token }
}

/** Who asked, for the daemon's records. Never a credential, and never trusted from the caller. */
function attribution(principal: Principal): Record<string, string> {
  return {
    'x-portta-actor': principal.actor,
    'x-portta-actor-kind': principal.actorKind,
    'x-portta-source': principal.source,
    ...(principal.userId ? { 'x-portta-user-id': principal.userId } : {}),
  }
}

function requestHeaders(incoming: Headers, token: string, principal: Principal): Headers {
  const headers = new Headers()
  for (const [name, value] of incoming) {
    if (!DROPPED_REQUEST.has(name) && !name.startsWith('x-portta-')) headers.set(name, value)
  }
  headers.set('authorization', `Bearer ${token}`)
  for (const [name, value] of Object.entries(attribution(principal))) headers.set(name, value)
  return headers
}

function findRoute(
  routes: RoutePermissionTable,
  method: string,
  path: string,
): { route: ProxyRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue
    const params = matchPath(route.pattern, path)
    if (params) return { route, params }
  }
  return null
}

/**
 * Hono routes that forward `/api/modules/<id>/*` to the same path on the host.
 *
 * Mounted by a server module at its own prefix. Authorisation is the table's:
 * the principal must hold the route's permission, in the route's scope when it
 * names one, before a byte is sent.
 */
export function createHostProxy(options: HostProxyOptions): Hono {
  const app = new Hono()
  const request = options.fetch ?? fetch
  const root = `/api/modules/${options.moduleId}`

  app.all('*', async (c) => {
    const path = c.req.path.startsWith(root) ? c.req.path.slice(root.length) || '/' : c.req.path
    const matched = findRoute(options.routes, c.req.method, path)
    if (!matched) return c.json({ error: `no such endpoint: ${c.req.path}` }, 404)

    const principal = principalOf(c)
    authorize(principal, matched.route.permission, await matched.route.scopeOf?.(matched.params, c))

    const target = hostTarget(options.config)
    const search = new URL(c.req.url).search
    const hasBody = !['GET', 'HEAD'].includes(c.req.method)
    let upstream: Response
    try {
      upstream = await request(`${target.url}${root}${path}${search}`, {
        method: c.req.method,
        headers: requestHeaders(c.req.raw.headers, target.token, principal),
        body: hasBody ? c.req.raw.body : undefined,
        signal: c.req.raw.signal,
        redirect: 'manual',
        // Required by Node's fetch to send a stream body without buffering it.
        ...(hasBody ? { duplex: 'half' } : {}),
      } as RequestInit)
    } catch (error) {
      if (c.req.raw.signal.aborted) throw error
      return c.json(
        {
          error: 'the host daemon is not reachable',
          hint: 'portta host serve starts it; portta doctor checks the rest',
        },
        502,
      )
    }

    for (const [name, value] of upstream.headers) {
      if (!DROPPED_RESPONSE.has(name)) c.header(name, value, { append: true })
    }
    return upstream.body ? c.body(upstream.body, upstream.status as 200) : c.body(null, upstream.status as 204)
  })

  return app
}

export interface HostWsRouteOptions {
  moduleId: string
  /** Below `/ws/modules/<id>`, such as `/runs/:id/terminal`. */
  path: string
  permission: Permission
  scopeOf?: WsRoute['scopeOf']
  config: Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'>
}

/** Closing codes a peer may send; everything else becomes a normal close. */
function closeCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000
}

/**
 * A panel WebSocket route whose other end is the same path on the host.
 *
 * The handshake has been authorised by the panel's upgrade handler before
 * `handle` runs; this opens the daemon's socket with the token and pipes frames
 * both ways, text as text and binary as binary. Frames that arrive before the
 * daemon answers are held, in order, rather than dropped. Either side closing
 * closes the other.
 */
export function createHostWsRoute(options: HostWsRouteOptions): WsRoute {
  const prefix = `/ws/modules/${options.moduleId}`
  return {
    path: `${prefix}${options.path}`,
    permission: options.permission,
    scopeOf: options.scopeOf ?? (async () => undefined),
    handle(socket, { url, principal }) {
      let target: { url: string; token: string }
      try {
        target = hostTarget(options.config)
      } catch (error) {
        socket.close(1011, error instanceof Error ? error.message.slice(0, 120) : 'host daemon unavailable')
        return
      }
      const upstream = new WebSocket(`${target.url.replace(/^http/, 'ws')}${url.pathname}${url.search}`, {
        headers: { authorization: `Bearer ${target.token}`, ...attribution(principal) },
      })
      const pending: { data: unknown; binary: boolean }[] = []

      socket.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data as Buffer, { binary })
        else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, binary })
      })
      upstream.on('open', () => {
        for (const frame of pending.splice(0)) upstream.send(frame.data as Buffer, { binary: frame.binary })
      })
      upstream.on('message', (data, binary) => {
        if (socket.readyState === socket.OPEN) socket.send(data as Buffer, { binary })
      })
      upstream.on('close', (code, reason) => {
        if (socket.readyState === socket.OPEN) socket.close(closeCode(code), reason.toString().slice(0, 120))
      })
      upstream.on('unexpected-response', (_request, response) => {
        if (socket.readyState === socket.OPEN)
          socket.close(1011, `the host daemon refused the socket (${response.statusCode ?? 'no status'})`)
        upstream.terminate()
      })
      upstream.on('error', () => {
        if (socket.readyState === socket.OPEN) socket.close(1011, 'the host daemon is not reachable')
      })
      socket.on('close', (code, reason) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.close(closeCode(code), reason.toString().slice(0, 120))
        else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate()
      })
    },
  }
}
