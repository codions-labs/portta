// The module's WebSocket routes, as the host daemon's upgrade handler takes them.
//
// The daemon authenticates the handshake and matches the path; what a route
// here adds is the Project its `:prefix` names. An unknown Project is refused
// before the handshake completes (`accepts`), so a refusal is still an HTTP
// status rather than a socket closed as soon as it opens.

import type { WebSocket } from 'ws'
import type { ProjectApp } from '../project-app.ts'

export interface WsContext<P> {
  params: Record<string, string>
  project: P
}

export interface WsRoute<P = ProjectApp> {
  /** `/:prefix/ws/:worktree`, below the module's socket mount. `:prefix` names the Project. */
  path: string
  /** Wire the socket up; returns the cleanup that runs once when it closes or its Project goes away. */
  handle(socket: WebSocket, context: WsContext<P>): () => void | Promise<void>
}

export interface ProjectSocketRoute {
  path: string
  accepts(params: Record<string, string>): boolean
  handle(socket: WebSocket, params: Record<string, string>): void
}

export interface ProjectSocketDeps<P> {
  projects: { get(prefix: string): P | undefined }
  /** Keeps the socket until it closes or its Project goes away, then runs its cleanup. */
  sockets: { track(prefix: string, socket: WebSocket, cleanup: () => void | Promise<void>): void }
}

/** Bind each route to the Project its `:prefix` names and to the socket tracker. */
export function projectSocketRoutes<P>(
  routes: readonly WsRoute<P>[],
  deps: ProjectSocketDeps<P>,
): ProjectSocketRoute[] {
  return routes.map((route) => ({
    path: route.path,
    accepts: (params) => deps.projects.get(params.prefix ?? '') !== undefined,
    handle: (socket, params) => {
      const prefix = params.prefix ?? ''
      const project = deps.projects.get(prefix)
      // Removed between the handshake and now.
      if (project === undefined) {
        socket.close(1011, 'project removed')
        return
      }
      deps.sockets.track(prefix, socket, route.handle(socket, { params, project }))
    },
  }))
}
