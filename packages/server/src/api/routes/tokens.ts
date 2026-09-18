// Personal API tokens.
//
// A token is a credential for a machine — the CLI on a laptop, an agent in a
// terminal, a job in CI — and it belongs to the person who made it. Everything
// about what it may do is decided from that: the rules are in
// `portta-auth-core/api-tokens.ts`, and these routes are the ownership half.
//
// Your own tokens need no permission beyond `token:*`, which every role holds.
// Somebody else's needs `user:list` to see and `user:update` to revoke, because
// revoking a colleague's credential is an administrative act.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createToken, findToken, listTokens, revokeToken, type TokenRecord } from 'portta-auth-core'
import { principalOf } from 'portta-auth-core/hono'
import { ApiTokens, CreateApiToken, CreatedApiToken } from 'portta-contracts'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { audit } from '../../services/audit.ts'
import { documentRoute } from '../openapi.ts'

const seconds = (value: Date | null): number | null => (value ? Math.floor(value.getTime() / 1000) : null)

const idParameter = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: 'The token id, as the listing gives it.',
  schema: { type: 'string' as const },
}

function view(record: TokenRecord) {
  return {
    id: record.id,
    name: record.name,
    start: record.start,
    actor: record.actor,
    actorKind: record.actorKind,
    scopes: record.scopes,
    createdAt: Math.floor(record.createdAt.getTime() / 1000),
    expiresAt: seconds(record.expiresAt),
    lastUsedAt: seconds(record.lastUsedAt),
    enabled: record.enabled,
    user: record.userEmail,
  }
}

export function tokenRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  function requireAuth() {
    if (!deps.auth) {
      throw new HTTPException(503, { message: 'this panel does not sign people in, so it has no tokens' })
    }
    return deps.auth
  }

  app.get(
    '/auth/tokens',
    documentRoute({
      tag: 'Authentication',
      operationId: 'listApiTokens',
      permission: 'token:read',
      summary: 'Your tokens, without their secrets',
      description: "Yours by default. `?all=true` lists everybody's and needs user:list.",
      parameters: [
        {
          name: 'all',
          in: 'query',
          required: false,
          description: "Every account's tokens, not only yours.",
          schema: { type: 'boolean', default: false },
        },
      ],
      response: ApiTokens,
      errors: [401, 403, 500, 503],
    }),
    async (c) => {
      requireAuth()
      const principal = principalOf(c)
      const all = c.req.query('all') === 'true'
      if (all && !principal.permissions.has('user:list')) {
        throw new HTTPException(403, { message: 'listing everybody’s tokens needs user:list' })
      }
      // A token of the local operator does not exist: in open mode there is
      // nobody to own one, and the route above already answered 503.
      const rows = await listTokens(deps.db.handle, all ? {} : { userId: principal.userId ?? '' })
      return c.json({ tokens: rows.map(view) })
    },
  )

  app.post(
    '/auth/tokens',
    documentRoute({
      tag: 'Authentication',
      operationId: 'createApiToken',
      permission: 'token:create',
      summary: 'Create a token for yourself',
      description:
        'The secret appears once, in this response. What the token holds is the intersection of its scopes and your role, computed on every request — so lowering your role lowers it too.',
      request: CreateApiToken,
      response: CreatedApiToken,
      status: 201,
      errors: [400, 401, 403, 500, 503],
    }),
    async (c) => {
      const auth = requireAuth()
      const principal = principalOf(c)
      if (principal.userId === null) {
        throw new HTTPException(403, { message: 'a token belongs to a person, and this request is not one' })
      }
      const body = CreateApiToken.parse(await c.req.json())
      const created = await createToken(
        { db: deps.db.handle, auth },
        {
          userId: principal.userId,
          name: body.name,
          actorKind: body.actorKind,
          ...(body.scopes ? { scopes: body.scopes } : {}),
          ...(body.expiresInDays === undefined ? {} : { expiresInDays: body.expiresInDays }),
        },
      )
      // Written here rather than in the service the way every other action is:
      // token creation lives in `portta-auth-core`, which the audit log must not
      // depend on, and this route is the only Portta code in the path.
      await audit(deps.db.handle, principal, {
        action: 'token.created',
        resourceType: 'token',
        resourceId: created.record.id,
        resourceName: created.record.name,
        metadata: { actorKind: created.record.actorKind, scopes: created.record.scopes.length },
      })
      return c.json({ token: created.token, credential: view(created.record) }, 201)
    },
  )

  app.delete(
    '/auth/tokens/:id',
    documentRoute({
      tag: 'Authentication',
      operationId: 'revokeApiToken',
      permission: 'token:revoke',
      summary: 'Revoke a token',
      description:
        'Effective on the next request that carries it. The row stays, so a listing can still say what was revoked.',
      response: z
        .object({ ok: z.literal(true), revoked: z.string() })
        .strict()
        .meta({ ref: 'RevokedApiToken' }),
      parameters: [idParameter],
      errors: [401, 403, 404, 500, 503],
    }),
    async (c) => {
      requireAuth()
      const principal = principalOf(c)
      const id = c.req.param('id')
      const record = await findToken(deps.db.handle, id)
      if (!record) throw new HTTPException(404, { message: `no token '${id}'` })
      // Revoking a colleague's credential is an administrative act, and it is not
      // the same permission as revoking your own.
      if (record.userId !== principal.userId && !principal.permissions.has('user:update')) {
        throw new HTTPException(403, { message: "revoking somebody else's token needs user:update" })
      }
      await revokeToken(deps.db.handle, id)
      await audit(deps.db.handle, principal, {
        action: 'token.revoked',
        resourceType: 'token',
        resourceId: id,
        resourceName: record.name,
        metadata: { owner: record.userEmail },
      })
      return c.json({ ok: true as const, revoked: id })
    },
  )

  return app
}
