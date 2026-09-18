// The daemon, as one process: an HTTP server, and one upgrade listener for the
// modules' sockets.
//
// A socket is authenticated before it is a socket, the same rule the panel's
// upgrade handler follows: a refusal is an HTTP status on a connection that is
// then destroyed, never an open socket waiting for a server that has decided.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { getRequestListener } from '@hono/node-server'
import { matchPath } from 'portta-core'
import { WebSocketServer } from 'ws'
import { createHostApp } from './app.ts'
import { bearerToken, tokenMatches } from './auth.ts'
import type { HostContext, HostModule, HostWsRoute } from './modules/index.ts'

export interface StartHostOptions {
  host: string
  port: number
  token: string
  modules: readonly HostModule[]
  context: HostContext
}

export interface RunningHost {
  server: Server
  /** `http://host:port`, with the port the system assigned when 0 was asked for. */
  url: string
  close: () => Promise<void>
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function wsRoutes(modules: readonly HostModule[], context: HostContext): HostWsRoute[] {
  return modules.flatMap((module) => {
    const prefix = `/ws/modules/${module.manifest.id}/`
    const routes = module.ws?.(context) ?? []
    for (const route of routes) {
      if (!route.path.startsWith(prefix))
        throw new Error(`module ${module.manifest.id}: WebSocket route ${route.path} is outside ${prefix}`)
    }
    return routes
  })
}

export function createHostUpgrade(
  options: Pick<StartHostOptions, 'token' | 'modules' | 'context'>,
  sockets: WebSocketServer,
) {
  const routes = wsRoutes(options.modules, options.context)
  return (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    // 401 before 404, so a caller without the token learns nothing about paths.
    if (!tokenMatches(bearerToken(request.headers.authorization), options.token)) {
      reject(socket, 401, 'Unauthorized')
      return
    }
    try {
      const matched = routes
        .map((route) => ({ route, params: matchPath(route.path, url.pathname) }))
        .find((candidate) => candidate.params !== null)
      if (!matched?.params || matched.route.accepts?.(matched.params) === false) {
        reject(socket, 404, 'Not Found')
        return
      }
      const params = matched.params
      sockets.handleUpgrade(request, socket, head, (ws) => matched.route.handle(ws, { params, url }))
    } catch {
      reject(socket, 500, 'Internal Server Error')
    }
  }
}

export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  const app = createHostApp(options)
  const sockets = new WebSocketServer({ noServer: true })
  const server = createServer(getRequestListener(app.fetch))
  server.on('upgrade', createHostUpgrade(options, sockets))

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address

  return {
    server,
    url: `http://${host}:${address.port}`,
    close: async () => {
      for (const socket of sockets.clients) socket.close(1001, 'the host daemon is shutting down')
      sockets.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      for (const module of options.modules) await module.close?.()
    },
  }
}
