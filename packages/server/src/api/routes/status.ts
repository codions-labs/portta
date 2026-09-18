import { Hono } from 'hono'
import { Overview } from 'portta-contracts'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { panelOverview } from '../../services/status.ts'
import { documentRoute } from '../openapi.ts'

export const HealthResponse = z
  .object({
    ok: z.literal(true),
    panelVersion: z.string(),
    gatewayVersion: z.string(),
  })
  .strict()
  .meta({ ref: 'HealthResponse' })

export function statusRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Liveness: answers even when Docker is unreachable, which is exactly when
  // somebody needs to know the panel itself is up.
  app.get(
    '/health',
    documentRoute({
      tag: 'Status',
      operationId: 'getHealth',
      public: true,
      summary: 'Check panel liveness',
      response: HealthResponse,
      responseDescription: 'Answers even when Docker is unreachable.',
      example: { ok: true, panelVersion: '0.1.0', gatewayVersion: '0.1.0' },
    }),
    (c) => c.json({ ok: true, panelVersion: deps.config.panelVersion, gatewayVersion: deps.config.gatewayVersion }),
  )

  app.get(
    '/status',
    documentRoute({
      tag: 'Status',
      operationId: 'getStatus',
      permission: 'gateway:read',
      summary: 'Get the gateway overview',
      response: Overview,
      errors: [500, 502],
    }),
    async (c) => c.json(await panelOverview(deps)),
  )

  return app
}
