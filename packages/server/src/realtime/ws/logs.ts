// A live log stream for one service of one environment.
//
// The parameters are validated before anything uses them, and nothing is
// concatenated into a command: the stream comes from the Docker API through
// the panel's own socket proxy, on the endpoint the allowlist already permits,
// exactly as the one-shot read does.
//
// The connection is authorised before it exists — `logs:read`, scoped to
// whichever Project adopted the environment — so a socket that is open is a
// socket that was allowed. Losing the membership closes nothing that is
// already open; that is what the next connection is for.

import { z } from 'portta-core/zod'
import type { WebSocket } from 'ws'
import type { AppDeps } from '../../deps.ts'
import { projectOfEnvironment } from '../../services/access-control.ts'
import { createLogDecoder } from '../../services/docker/client.ts'
import { findRememberedEnvironment } from '../../services/remembered.ts'
import { NotFound, type WsRoute } from './upgrade.ts'

/** How long a quiet stream waits before saying it is still there. */
const HEARTBEAT_MS = 30_000

const query = z.object({
  service: z.string().min(1).max(128).optional(),
  tail: z.coerce.number().int().min(1).max(2000).default(200),
})

export function logStreamRoute(deps: AppDeps): WsRoute {
  return {
    path: '/ws/environments/:name/logs',
    permission: 'logs:read',

    async scopeOf(params) {
      const snapshot = await deps.cache.get()
      const environment =
        snapshot.environments.find((item) => item.name === params.name) ??
        (await findRememberedEnvironment(deps.db, snapshot, deps.config, params.name ?? ''))
      // A 404 before the authorisation would say which environments exist to
      // somebody who may not see any of them, so this answers the scope
      // question and lets `authorize` refuse first. An environment that is not
      // there resolves to no Project, which only `scope: 'all'` reaches — and
      // for them the handler below says it does not exist.
      if (!environment) return { projectId: null }
      return { projectId: await projectOfEnvironment(deps.db, params.name ?? '') }
    },

    handle(socket, { params, url }) {
      const parsed = query.safeParse(Object.fromEntries(url.searchParams))
      if (!parsed.success) {
        socket.close(1008, 'invalid parameters')
        return
      }
      void follow(deps, socket, params.name ?? '', parsed.data)
    },
  }
}

async function follow(
  deps: AppDeps,
  socket: WebSocket,
  name: string,
  options: { service?: string | undefined; tail: number },
): Promise<void> {
  const controller = new AbortController()
  const heartbeat = setInterval(() => {
    if (socket.readyState === socket.OPEN) socket.ping()
  }, HEARTBEAT_MS)

  const stop = () => {
    clearInterval(heartbeat)
    controller.abort()
  }
  socket.on('close', stop)
  socket.on('error', stop)

  try {
    const snapshot = await deps.cache.get()
    const environment = snapshot.environments.find((item) => item.name === name)
    if (!environment) throw new NotFound(`no environment '${name}' is running`)

    const service = options.service
      ? environment.services.find((item) => (item.service ?? item.name) === options.service)
      : environment.services[0]
    if (!service) throw new NotFound(`no service '${options.service}' in '${name}'`)

    const { stream, multiplexed } = await deps.client.followLogs(service.id, {
      tail: options.tail,
      signal: controller.signal,
    })
    const decode = createLogDecoder(multiplexed)
    const label = service.service ?? service.name

    socket.send(JSON.stringify({ kind: 'open', environment: name, service: label }))

    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      if (socket.readyState !== socket.OPEN) break
      const lines = decode(chunk)
      if (lines.length > 0) socket.send(JSON.stringify({ kind: 'lines', service: label, lines }))
    }
    // Docker ended the stream: the container stopped, or was removed. The
    // client learns that from the close rather than from silence.
    if (socket.readyState === socket.OPEN) socket.close(1000, 'stream ended')
  } catch (cause) {
    if (controller.signal.aborted) return
    const message = cause instanceof NotFound ? cause.message : 'the log stream could not be read'
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ kind: 'error', message }))
      socket.close(cause instanceof NotFound ? 1008 : 1011, message)
    }
  } finally {
    stop()
  }
}
