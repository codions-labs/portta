import { type Context, Hono } from 'hono'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { ExposureResult, ExposureView } from 'portta-contracts'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import { adoptions, projectOfEnvironment, visible } from '../../services/access-control.ts'
import { findContainer } from '../../services/actions.ts'
import { closeService, listExposure, openService, protectService } from '../../services/exposure.ts'
import { record } from '../audit.ts'
import { containerIdParameter, documentRoute } from '../openapi.ts'

const protectBody = z
  .object({
    user: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
  })
  .strict()

export function exposureRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function reach(c: Context, environment: string | null | undefined): Promise<void> {
    authorizeScope(c, environment ? await projectOfEnvironment(deps.db, environment) : null)
  }

  app.get(
    '/exposure',
    documentRoute({
      tag: 'Shares',
      operationId: 'listExposure',
      permission: 'access:read',
      summary: 'Who may open each service hostname',
      description:
        'The ForwardAuth registry, without credentials. On a public host a hostname with no entry is closed.',
      response: ExposureView,
      errors: [500],
    }),
    async (c) => {
      // Scoped like the shares list: a record names its project, and a record
      // with none is for somebody who sees everything.
      const owners = await adoptions(deps.db)
      return c.json({
        enforced: deps.config.profile === 'remote-public',
        entries: visible(principalOf(c), listExposure(deps.config), (entry) =>
          entry.project ? (owners.get(entry.project) ?? null) : null,
        ),
      })
    },
  )

  app.put(
    '/services/:id/exposure',
    documentRoute({
      tag: 'Shares',
      operationId: 'protectService',
      permission: 'service:protect',
      summary: 'Ask for a credential to open a service',
      description:
        'Generates a password, shown once; only its hash is stored. Calling it again replaces the password. Takes effect on the next request.',
      request: protectBody,
      response: ExposureResult,
      parameters: [containerIdParameter],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const body = protectBody.parse(await c.req.json().catch(() => ({})))
      const snapshot = await deps.cache.get()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const change = await protectService(deps.config, container, body, snapshot.containers)
      await record(deps, c, {
        action: change.action,
        resourceType: 'service',
        resourceId: container.id,
        resourceName: change.entry?.host ?? container.name,
      })
      return c.json({
        ok: true,
        entry: change.entry,
        ...(change.password ? { password: change.password } : {}),
        note: 'the password is shown once and only its hash is stored',
      })
    },
  )

  app.post(
    '/services/:id/exposure/open',
    documentRoute({
      tag: 'Shares',
      operationId: 'openService',
      permission: 'service:protect',
      summary: 'Let everybody open a service, with no login',
      response: ExposureResult,
      parameters: [containerIdParameter],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const change = openService(deps.config, container, snapshot.containers)
      await record(deps, c, {
        action: change.action,
        resourceType: 'service',
        resourceId: container.id,
        resourceName: change.entry?.host ?? container.name,
      })
      return c.json({ ok: true, entry: change.entry, note: 'no login is asked for this hostname' })
    },
  )

  app.delete(
    '/services/:id/exposure',
    documentRoute({
      tag: 'Shares',
      operationId: 'closeService',
      permission: 'service:protect',
      summary: 'Remove the decision for a service hostname',
      description: 'On a public host the hostname is closed afterwards.',
      response: ExposureResult,
      parameters: [containerIdParameter],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const change = closeService(deps.config, container)
      await record(deps, c, {
        action: change.action,
        resourceType: 'service',
        resourceId: container.id,
        resourceName: container.name,
      })
      return c.json({ ok: true, entry: null, note: 'the decision was removed' })
    },
  )

  return app
}
