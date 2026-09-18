// One process, four dispatches.
//
// The panel is loopback by default, with no proxy in front of it, and a session
// cookie has to have a single origin. So the API, the event stream, the
// WebSocket upgrades and the pages are all served by one HTTP server, and this
// module is the part of it that decides which is which.
//
// It takes handlers rather than building them, so a test can drive the whole
// dispatch with a fake Next and no Docker, no database and no port.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { getRequestListener } from '@hono/node-server'
import type { Hono } from 'hono'

/** Anything the composition starts at boot and stops on the way down. */
export interface Startable {
  start(): void
  stop(): void
}

export type NextHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>

export interface PorttaDeps {
  /**
   * The panel's Hono app. It mounts the API at `/api` and carries the error
   * handling that turns a domain refusal into the status it deserves; the
   * event stream is one of its routes.
   */
  api: Hono
  documentation?: { docs: boolean; apiDocs: boolean }
  /** Next's request handler: everything that is not the API. */
  next: NextHandler
  /**
   * Next's own upgrade handler, for HMR in development. Absent in production,
   * where nothing but `/ws/*` ever asks to upgrade.
   */
  nextUpgrade?: UpgradeHandler | undefined
  /**
   * The panel's own upgrade handler: everything under `/ws/`.
   *
   * It answers whether the path was its own, so this module never has to know
   * which `/ws/…` routes exist — and a path under `/ws/` that no route matches
   * is still refused there rather than falling through to Next, which would
   * leave the socket open.
   */
  wsUpgrade?: ((request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean>) | undefined
  /** Intervals the panel owns. Started after `listen`, stopped before close. */
  jobs?: Startable[]
  /** Connections to close on the way down: the database pool, the event hub. */
  close?: () => Promise<void>
}

export interface Portta {
  handle: (request: IncomingMessage, response: ServerResponse) => void
  upgrade: UpgradeHandler
  start: () => void
  stop: () => Promise<void>
}

/** `/api`, `/api/…` — and not `/apiary`. */
function isApi(url: string): boolean {
  const path = url.split('?')[0] ?? '/'
  return path === '/api' || path.startsWith('/api/')
}

/**
 * Refuse an upgrade before it becomes a socket.
 *
 * A WebSocket handshake that fails has to be answered as HTTP and then closed;
 * leaving the socket open is how a client ends up waiting forever for a server
 * that has already decided.
 */
function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function createPortta(deps: PorttaDeps): Portta {
  const api = getRequestListener(deps.api.fetch)
  const jobs = deps.jobs ?? []

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/\/+$/, '') || '/'
    } catch {
      response.writeHead(400)
      response.end('Bad Request')
      return
    }
    const docs = deps.documentation
    if (
      docs &&
      (pathname === '/docs' || pathname.startsWith('/docs/')) &&
      (!docs.docs || (pathname === '/docs/api' && !docs.apiDocs))
    ) {
      response.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      response.end('Not Found')
      return
    }
    if (isApi(request.url ?? '/')) {
      api(request, response)
      return
    }
    void deps.next(request, response)
  }

  const upgrade: UpgradeHandler = async (request, socket, head) => {
    // The panel's handler decides for every `/ws/…` path, including the ones it
    // refuses. Anything else is Next's, or nobody's.
    if (deps.wsUpgrade && (await deps.wsUpgrade(request, socket, head))) return
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    if (path.startsWith('/ws/')) {
      reject(socket, 404, 'Not Found')
      return
    }
    if (deps.nextUpgrade) {
      void deps.nextUpgrade(request, socket, head)
      return
    }
    reject(socket, 404, 'Not Found')
  }

  return {
    handle,
    upgrade,
    start: () => {
      for (const job of jobs) job.start()
    },
    stop: async () => {
      for (const job of jobs) job.stop()
      await deps.close?.()
    },
  }
}
