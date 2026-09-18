import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { principalOf } from 'portta-auth-core/hono'
import type { LiveEvent } from 'portta-contracts'
import { documentRoute, eventStreamResponse } from '../api/openapi.ts'
import type { AppDeps } from '../deps.ts'
import { eventVisibility } from '../services/access-control.ts'

const KEEPALIVE_MS = 20_000

export function eventRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Server-sent events, not a WebSocket: the traffic is one-way and the
  // browser reconnects on its own.
  app.get(
    '/events',
    documentRoute({
      tag: 'Events',
      operationId: 'streamEvents',
      permission: 'activity:read',
      summary: 'Stream runtime events',
      description: 'Server-sent events. Each non-ping data frame is a JSON LiveEvent; clients reconnect normally.',
      response: eventStreamResponse,
      mediaType: 'text/event-stream',
      responseDescription: 'An open SSE stream.',
      errors: [500, 502],
    }),
    (c) => {
      // Resolved once, before the stream opens: a subscriber that outlived its
      // own membership keeps the stream and stops seeing the Projects it left.
      const principal = principalOf(c)
      const visibility = eventVisibility(deps.db, principal)
      return streamSSE(c, async (stream) => {
        const pending: LiveEvent[] = []
        let wake: (() => void) | null = null
        let active = true

        const unsubscribe = deps.hub.subscribe((event) => {
          pending.push(event)
          wake?.()
        })

        stream.onAbort(() => {
          active = false
          unsubscribe()
          wake?.()
        })

        const hello: LiveEvent = {
          kind: 'hello',
          action: 'connected',
          id: null,
          // Who this stream belongs to. A stream is filtered to one principal, so
          // saying which one is what makes an unexpected filtering explicable
          // rather than a bug somebody hunts in the client.
          name: principal.actor,
          project: null,
          ownership: null,
          at: Math.floor(Date.now() / 1000),
        }
        await stream.writeSSE({ event: 'hello', data: JSON.stringify(hello) })

        let lastKeepalive = Date.now()
        try {
          while (active) {
            if (pending.length > 0) await visibility.refresh()
            while (pending.length > 0 && active) {
              const event = pending.shift()
              if (!event) break
              // An event about a Project this caller does not reach is not
              // delivered late or redacted; it is not delivered.
              if (!visibility.allows(event)) continue
              await stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
            }
            if (!active) break
            if (Date.now() - lastKeepalive >= KEEPALIVE_MS) {
              await stream.writeSSE({ event: 'ping', data: String(Math.floor(Date.now() / 1000)) })
              lastKeepalive = Date.now()
            }
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                wake = null
                resolve()
              }, 1000)
              wake = () => {
                clearTimeout(timer)
                wake = null
                resolve()
              }
            })
          }
        } finally {
          unsubscribe()
        }
      })
    },
  )

  return app
}
