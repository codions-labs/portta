import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { AccessView, Bridge, ServiceConnection } from 'portta-contracts'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import {
  closeBridge,
  listBridges,
  listForwarders,
  listTcpServices,
  openBridge,
  serviceConnection,
} from '../../services/access.ts'
import { adoptions, projectOfEnvironment, visible } from '../../services/access-control.ts'
import { record } from '../audit.ts'
import { bridgeIdParameter, documentRoute, projectParameter } from '../openapi.ts'

const openBody = z
  .object({
    project: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    service: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    port: z.number().int().min(1).max(65535).optional(),
    localPort: z.number().int().min(1024).max(65535).optional(),
    ttlSeconds: z.number().int().min(30).max(86400).optional(),
  })
  .strict()

export const OpenBridgeResponse = z
  .object({ ok: z.literal(true), bridge: Bridge.nullable() })
  .strict()
  .meta({ ref: 'OpenBridgeResponse' })
export const CloseBridgeResponse = z
  .object({ ok: z.literal(true), message: z.string() })
  .strict()
  .meta({ ref: 'CloseBridgeResponse' })

const serviceParameter = {
  name: 'service',
  in: 'path' as const,
  required: true,
  description: 'Compose service name.',
  schema: { type: 'string' as const },
}

export function accessRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * A bridge, a forwarder and a share are all about one environment, so that is
   * the Project they belong to. One nothing adopted belongs to nobody.
   */
  async function reach(c: Context, environment: string | null | undefined): Promise<void> {
    authorizeScope(c, environment ? await projectOfEnvironment(deps.db, environment) : null)
  }

  app.get(
    '/access',
    documentRoute({
      tag: 'Access',
      operationId: 'getAccess',
      permission: 'access:read',
      summary: 'List private TCP services and temporary bridges',
      response: AccessView,
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const principal = principalOf(c)
      const owners = await adoptions(deps.db)
      const of = (row: { project?: string | null }) => (row.project ? (owners.get(row.project) ?? null) : null)
      const view: AccessView = {
        services: visible(principal, listTcpServices(snapshot, deps.config), of),
        bridges: visible(principal, listBridges(snapshot), of),
        forwarders: visible(principal, listForwarders(snapshot), of),
        bridgeImageHint: deps.config.bridgeImage,
        tcpRoutingEnabled: deps.config.tcpEnabled,
      }
      return c.json(view)
    },
  )

  app.get(
    '/access/services/:project/:service/connection',
    documentRoute({
      tag: 'Access',
      operationId: 'getServiceConnection',
      permission: 'access:open',
      summary:
        'Get every address a datastore has, and a connection string with credentials when they can be discovered',
      description:
        'The only route that returns a discovered password. The value is read from the container environment for this request, is not cached, and must not appear in an example, a log or a database row.',
      response: ServiceConnection,
      parameters: [projectParameter, serviceParameter],
      errors: [404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const project = c.req.param('project')
      const service = c.req.param('service')
      const container = snapshot.containers.find(
        (item) => item.environment === project && item.service === service && !item.oneOff,
      )
      if (!container) {
        throw new HTTPException(404, { message: `no service ${project}/${service}` })
      }
      await reach(c, project)
      const inspect = await deps.client.inspect(container.id)
      const bridges = listBridges(snapshot)
      const bridge = bridges.find((item) => item.project === project && item.service === service) ?? null
      return c.json(serviceConnection(container, inspect.Config.Env, deps.config, bridge))
    },
  )

  // Opens the same loopback bridge `portta access open` creates. The
  // panel offers no way to bind it anywhere but 127.0.0.1.
  app.post(
    '/access',
    documentRoute({
      tag: 'Access',
      operationId: 'openAccess',
      permission: 'access:open',
      summary: 'Open a loopback bridge to a TCP service',
      description: 'The panel always binds the bridge to 127.0.0.1.',
      response: OpenBridgeResponse,
      status: 201,
      request: openBody,
      errors: [400, 403, 404, 409, 500, 502],
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null)
      const parsed = openBody.safeParse(body)
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        })
      }

      const snapshot = await deps.cache.get(true)
      await reach(c, parsed.data.project)
      const opened = await openBridge(deps.client, snapshot, deps.config, parsed.data)
      deps.cache.invalidate()

      const refreshed = await deps.cache.get(true)
      const bridge = listBridges(refreshed).find((item) => item.id === opened.bridgeId) ?? null
      await record(deps, c, {
        action: 'access.bridge_opened',
        resourceType: 'bridge',
        resourceId: opened.bridgeId,
        resourceName: `${parsed.data.project}/${parsed.data.service}`,
        metadata: { port: bridge?.localPort ?? null },
      })
      return c.json({ ok: true, bridge }, 201)
    },
  )

  app.delete(
    '/access/:id',
    documentRoute({
      tag: 'Access',
      operationId: 'closeAccess',
      permission: 'access:open',
      summary: 'Close a gateway-owned bridge',
      response: CloseBridgeResponse,
      parameters: [bridgeIdParameter],
      errors: [400, 403, 404, 500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get(true)
      // The bridge is closed by id, so the environment comes from the bridge.
      await reach(c, listBridges(snapshot).find((bridge) => bridge.id === c.req.param('id'))?.project)
      const closing = listBridges(snapshot).find((bridge) => bridge.id === c.req.param('id')) ?? null
      await closeBridge(deps.client, snapshot, c.req.param('id'))
      deps.cache.invalidate()
      await record(deps, c, {
        action: 'access.bridge_closed',
        resourceType: 'bridge',
        resourceId: c.req.param('id'),
        resourceName: closing ? `${closing.project}/${closing.service}` : null,
      })
      return c.json({ ok: true, message: 'bridge closed; the service itself was not touched' })
    },
  )

  return app
}
