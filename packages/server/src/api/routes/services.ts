import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { ContainerSummary, LogsResponse, ServiceTraefik } from 'portta-contracts'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { adoptions, projectOfEnvironment, visible } from '../../services/access-control.ts'
import { findContainer } from '../../services/actions.ts'
import { dashboardRouterUrl, routersFor } from '../../services/traefik.ts'
import { containerIdParameter, documentRoute, tailParameter } from '../openapi.ts'

const MAX_TAIL = 2000
export const ServicesResponse = z
  .object({ services: z.array(ContainerSummary) })
  .strict()
  .meta({ ref: 'ServicesResponse' })

export function serviceRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * A container, and whether this caller reaches the environment it runs in.
   *
   * A service is a container of an adopted environment, so its Project is the
   * environment's. One in an environment nothing adopted belongs to nobody.
   */
  async function reach(c: Context, environment: string | null): Promise<void> {
    authorizeScope(c, environment === null ? null : await projectOfEnvironment(deps.db, environment))
  }

  // A "service" is a container that belongs to an integrated project. It is the
  // same object the Docker page shows, filtered to what the gateway manages.
  app.get(
    '/services',
    documentRoute({
      tag: 'Services',
      operationId: 'listServices',
      permission: 'service:read',
      summary: 'List services in adopted projects',
      response: ServicesResponse,
      parameters: [
        {
          name: 'project',
          in: 'query',
          required: false,
          description: 'Filter by COMPOSE_PROJECT_NAME.',
          schema: { type: 'string' },
        },
      ],
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const project = c.req.query('project')
      const integrated = new Set(snapshot.environments.filter((item) => item.integrated).map((item) => item.name))
      const services = snapshot.containers.filter(
        (container) =>
          container.environment !== null &&
          !container.oneOff &&
          integrated.has(container.environment) &&
          (project === undefined || container.environment === project),
      )
      const owners = await adoptions(deps.db)
      return c.json({
        services: visible(principalOf(c), services, (container) =>
          container.environment === null ? null : (owners.get(container.environment) ?? null),
        ),
      })
    },
  )

  app.get(
    '/services/:id',
    documentRoute({
      tag: 'Services',
      operationId: 'getService',
      permission: 'service:read',
      summary: 'Get one service container',
      response: ContainerSummary,
      parameters: [containerIdParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      return c.json(container)
    },
  )

  app.get(
    '/services/:id/logs',
    documentRoute({
      tag: 'Services',
      operationId: 'getServiceLogs',
      permission: 'logs:read',
      summary: 'Read recent service logs',
      response: LogsResponse,
      parameters: [containerIdParameter, tailParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const container = findContainer(await deps.cache.get(), c.req.param('id'))
      await reach(c, container.environment)
      return c.json(await readLogs(deps, c.req.param('id'), c.req.query('tail')))
    },
  )

  /**
   * What Traefik says about this service, beside what its labels say. Off its
   * own cache and its own timeout: an unreachable Traefik API answers
   * `available: false` with the reason, and the rest of the panel is unaffected.
   */
  app.get(
    '/services/:id/traefik',
    documentRoute({
      tag: 'Services',
      operationId: 'getServiceTraefik',
      permission: 'service:read',
      summary: "Get Traefik's verdict for a service",
      response: ServiceTraefik,
      parameters: [containerIdParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const verdict = await deps.verdict.get()

      const body: ServiceTraefik = {
        containerId: container.id,
        available: verdict.available,
        reason: verdict.reason,
        expectedHosts: container.urls.map((url) => url.host),
        routers: routersFor(container, verdict).map((router) => ({
          ...router,
          dashboardUrl: dashboardRouterUrl(deps.config, router.name),
        })),
        fetchedAt: verdict.fetchedAt,
      }
      return c.json(body)
    },
  )

  return app
}

export async function readLogs(deps: AppDeps, id: string, tailParam?: string): Promise<LogsResponse> {
  const snapshot = await deps.cache.get()
  const container = findContainer(snapshot, id)
  const requested = Number(tailParam ?? '200')
  const tail = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_TAIL) : 200

  const lines = await deps.client.logs(container.id, { tail }).catch((cause: Error) => {
    throw new HTTPException(502, { message: `could not read logs: ${cause.message}` })
  })

  return {
    containerId: container.id,
    name: container.name,
    lines,
    truncated: lines.length >= tail,
  }
}
