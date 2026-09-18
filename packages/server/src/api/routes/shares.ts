import { type Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { Share, ShareView } from 'portta-contracts'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import { adoptions, projectOfEnvironment, visible } from '../../services/access-control.ts'
import { findContainer } from '../../services/actions.ts'
import {
  createShare,
  listShares,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  regenerateShare,
  revokeShare,
} from '../../services/shares.ts'
import { record } from '../audit.ts'
import { containerIdParameter, documentRoute, shareIdParameter } from '../openapi.ts'

const createBody = z
  .object({
    mode: z.enum(['public', 'protected']),
    ttlSeconds: z.number().int().min(MIN_TTL_SECONDS).max(MAX_TTL_SECONDS).optional(),
    user: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
  })
  .strict()

export const CreatedShareResponse = z
  .object({
    ok: z.literal(true),
    share: Share,
    password: z.string(),
    note: z.string(),
  })
  .strict()
  .meta({ ref: 'CreatedShareResponse' })
export const RevokeShareResponse = z
  .object({ ok: z.literal(true), message: z.string() })
  .strict()
  .meta({ ref: 'RevokeShareResponse' })

export function shareRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /** A share is an extra hostname for one environment's service. */
  async function reach(c: Context, environment: string | null | undefined): Promise<void> {
    authorizeScope(c, environment ? await projectOfEnvironment(deps.db, environment) : null)
  }

  app.get(
    '/shares',
    documentRoute({
      tag: 'Shares',
      operationId: 'listShares',
      permission: 'access:read',
      summary: 'List temporary service shares',
      response: ShareView,
      errors: [500],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const owners = await adoptions(deps.db)
      const view: ShareView = {
        shares: visible(
          principalOf(c),
          listShares(deps.config, snapshot),
          (share) => owners.get(share.project) ?? null,
        ),
        domain: `share.${deps.config.publicDomain ?? deps.config.domain}`,
        publicAllowed: deps.config.publicEnabled && deps.config.publicDomain !== null,
        maxTtlSeconds: MAX_TTL_SECONDS,
      }
      return c.json(view)
    },
  )

  /**
   * A share is an additional hostname for one service. The project's own
   * router is untouched, the expiry is mandatory, and the password is in this
   * response and nowhere else, ever.
   */
  app.post(
    '/services/:id/share',
    documentRoute({
      tag: 'Shares',
      operationId: 'createShare',
      permission: 'access:manage',
      summary: 'Create an expiring route for one service',
      description: 'The generated password appears in this response once; only its hash is stored.',
      response: CreatedShareResponse,
      status: 201,
      request: createBody,
      parameters: [containerIdParameter],
      errors: [400, 403, 404, 409, 500],
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null)
      const parsed = createBody.safeParse(body)
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        })
      }

      const snapshot = await deps.cache.get(true)
      const container = findContainer(snapshot, c.req.param('id'))
      await reach(c, container.environment)
      const created = await createShare(deps.config, snapshot, container, parsed.data)
      // The password is in the response and nowhere else, so it is not here
      // either: what the log holds is the hostname and when it stops working.
      await record(deps, c, {
        action: 'share.created',
        resourceType: 'share',
        resourceId: created.share.id,
        resourceName: created.share.host,
        metadata: { mode: created.share.mode, expiresAt: created.share.expiresAt },
      })

      return c.json(
        {
          ok: true,
          share: created.share,
          password: created.password,
          note: 'the password is shown once and only its hash is stored',
        },
        201,
      )
    },
  )

  app.post(
    '/shares/:id/regenerate',
    documentRoute({
      tag: 'Shares',
      operationId: 'regenerateShare',
      permission: 'access:manage',
      summary: 'Replace a protected share password',
      response: CreatedShareResponse,
      parameters: [shareIdParameter],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      await reach(c, listShares(deps.config, snapshot).find((share) => share.id === c.req.param('id'))?.project)
      const created = await regenerateShare(deps.config, snapshot, c.req.param('id'))
      return c.json({
        ok: true,
        share: created.share,
        password: created.password,
        note: 'the previous password stopped working the moment this was generated',
      })
    },
  )

  app.delete(
    '/shares/:id',
    documentRoute({
      tag: 'Shares',
      operationId: 'revokeShare',
      permission: 'access:manage',
      summary: 'Revoke a temporary share',
      response: RevokeShareResponse,
      parameters: [shareIdParameter],
      errors: [400, 403, 404, 500],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      await reach(c, listShares(deps.config, snapshot).find((share) => share.id === c.req.param('id'))?.project)
      const revoking = listShares(deps.config, snapshot).find((share) => share.id === c.req.param('id')) ?? null
      revokeShare(deps.config, c.req.param('id'))
      await record(deps, c, {
        action: 'share.revoked',
        resourceType: 'share',
        resourceId: c.req.param('id'),
        resourceName: revoking?.host ?? null,
      })
      return c.json({ ok: true, message: 'share revoked; the project itself was not touched' })
    },
  )

  return app
}
