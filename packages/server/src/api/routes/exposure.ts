import { type Context, Hono } from 'hono'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { ExposureResult, ExposureView } from 'portta-contracts'
import { openCatchAllContainers } from 'portta-core'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import { adoptions, projectOfEnvironment, visible } from '../../services/access-control.ts'
import { findContainer } from '../../services/actions.ts'
import { closeService, listExposure, openService, protectService } from '../../services/exposure.ts'
import { aliasViewFor, applySnapshotOverrides, EMPTY_OVERRIDES } from '../../services/overrides.ts'
import { record } from '../audit.ts'
import { containerIdParameter, documentRoute } from '../openapi.ts'

const protectBody = z
  .object({
    user: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .nullable()
      .optional()
      .describe('A login name to ask for beside the password. null asks for the password alone.'),
    host: z.string().min(1).max(253).optional(),
  })
  .strict()

export function exposureRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function snapshotWithAliases() {
    return applySnapshotOverrides(await deps.cache.get(), EMPTY_OVERRIDES, aliasViewFor(deps.config))
  }

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
      const enforced = deps.config.profile === 'remote-public'
      const open = enforced ? openCatchAllContainers((await deps.cache.get()).containers) : []
      return c.json({
        enforced,
        // Everybody learns that addresses cannot be trusted; only who sees a
        // project learns the name of what is running in it.
        openRouters: {
          count: open.length,
          names: visible(principalOf(c), open, (container) =>
            container.environment ? (owners.get(container.environment) ?? null) : null,
          ).map((container) => container.name),
        },
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
      const snapshot = await snapshotWithAliases()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const change = await protectService(
        deps.config,
        container,
        { ...body, unscoped: principalOf(c).scope === 'all' },
        snapshot.containers,
      )
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
      request: z.object({ host: z.string().min(1).max(253).optional() }).strict(),
      response: ExposureResult,
      parameters: [containerIdParameter],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const body = z
        .object({ host: z.string().min(1).max(253).optional() })
        .strict()
        .parse(await c.req.json().catch(() => ({})))
      const snapshot = await snapshotWithAliases()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const change = openService(deps.config, container, snapshot.containers, principalOf(c).scope === 'all', body.host)
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
      parameters: [
        containerIdParameter,
        {
          name: 'host',
          in: 'query' as const,
          required: false,
          description: 'The one hostname whose decision is removed.',
          schema: { type: 'string' as const },
        },
      ],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const snapshot = await snapshotWithAliases()
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const change = closeService(deps.config, container, principalOf(c).scope === 'all', c.req.query('host'))
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
