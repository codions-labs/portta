// Who may use this panel.
//
// Nine operations, each declaring the permission it needs. The rules that a
// permission cannot express — nobody changes their own role, only the owner
// acts on the owner, the last owner stays — are in `services/users.ts`, applied
// after the permission and before Better Auth is called.

import { Hono } from 'hono'
import { principalOf } from 'portta-auth-core/hono'
import { BanUser, CreateUser, SetPassword, SetRole, SetUserProjects, User, UserSessions, Users } from 'portta-contracts'
import { z } from 'portta-core/zod'
import type { AppDeps } from '../../deps.ts'
import { UsersService } from '../../services/users.ts'
import { documentRoute } from '../openapi.ts'

const idParameter = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: 'The user id, as the panel generated it.',
  schema: { type: 'string' as const },
}

const Ok = z
  .object({ ok: z.literal(true) })
  .strict()
  .meta({ ref: 'Ok' })

export function userRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  const users = () => new UsersService({ db: deps.db.handle, auth: deps.auth })

  app.get(
    '/users',
    documentRoute({
      tag: 'Users',
      operationId: 'listUsers',
      permission: 'user:list',
      summary: 'Every account, with the Projects each one reaches',
      description: 'A panel with PORTTA_AUTH_MODE=disabled has no accounts and answers 503: there is nobody to be.',
      response: Users,
      errors: [401, 403, 500, 503],
    }),
    async (c) => c.json({ users: await users().list() }),
  )

  app.get(
    '/users/:id',
    documentRoute({
      tag: 'Users',
      operationId: 'getUser',
      permission: 'user:get',
      summary: 'One account',
      response: User,
      parameters: [idParameter],
      errors: [401, 403, 404, 500, 503],
    }),
    async (c) => c.json(await users().find(c.req.param('id'))),
  )

  app.post(
    '/users',
    documentRoute({
      tag: 'Users',
      operationId: 'createUser',
      permission: 'user:create',
      summary: 'Create an account',
      description: 'The password is set here and never returned. `owner` cannot be assigned: it is transferred.',
      request: CreateUser,
      response: User,
      status: 201,
      errors: [400, 401, 403, 500, 503],
    }),
    async (c) => {
      const body = CreateUser.parse(await c.req.json())
      return c.json(await users().create(principalOf(c), c.req.raw.headers, body), 201)
    },
  )

  app.patch(
    '/users/:id/role',
    documentRoute({
      tag: 'Users',
      operationId: 'setUserRole',
      permission: 'user:set-role',
      summary: "Change an account's role",
      request: SetRole,
      response: User,
      parameters: [idParameter],
      errors: [400, 401, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = SetRole.parse(await c.req.json())
      return c.json(await users().setRole(principalOf(c), c.req.raw.headers, c.req.param('id'), body.role))
    },
  )

  app.patch(
    '/users/:id/password',
    documentRoute({
      tag: 'Users',
      operationId: 'setUserPassword',
      permission: 'user:set-password',
      summary: "Set an account's password",
      description:
        'Every session that account had is revoked: a password that leaves the old sessions open sets nothing.',
      request: SetPassword,
      response: Ok,
      parameters: [idParameter],
      errors: [400, 401, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = SetPassword.parse(await c.req.json())
      await users().setPassword(principalOf(c), c.req.raw.headers, c.req.param('id'), body.password)
      return c.json({ ok: true as const })
    },
  )

  app.patch(
    '/users/:id/ban',
    documentRoute({
      tag: 'Users',
      operationId: 'banUser',
      permission: 'user:ban',
      summary: 'Ban or unban an account',
      description:
        "A ban takes effect on that account's next request, not their next sign-in: somebody with an open session is exactly who a ban is for.",
      request: BanUser,
      response: User,
      parameters: [idParameter],
      errors: [400, 401, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = BanUser.parse(await c.req.json())
      return c.json(await users().setBan(principalOf(c), c.req.raw.headers, c.req.param('id'), body))
    },
  )

  app.delete(
    '/users/:id',
    documentRoute({
      tag: 'Users',
      operationId: 'removeUser',
      permission: 'user:delete',
      summary: 'Remove an account',
      description:
        'Sessions, accounts, tokens and memberships go with it. The work it did stays, under the name it was done with.',
      response: Ok,
      parameters: [idParameter],
      errors: [401, 403, 404, 500, 503],
    }),
    async (c) => {
      await users().remove(principalOf(c), c.req.raw.headers, c.req.param('id'))
      return c.json({ ok: true as const })
    },
  )

  app.get(
    '/users/:id/sessions',
    documentRoute({
      tag: 'Users',
      operationId: 'listUserSessions',
      permission: 'session:list',
      summary: "An account's open sessions",
      response: UserSessions,
      parameters: [idParameter],
      errors: [401, 403, 404, 500, 503],
    }),
    async (c) => c.json({ sessions: await users().sessionsOf(principalOf(c), c.req.raw.headers, c.req.param('id')) }),
  )

  app.delete(
    '/users/:id/sessions',
    documentRoute({
      tag: 'Users',
      operationId: 'revokeUserSessions',
      permission: 'session:revoke',
      summary: 'End every session of an account',
      response: Ok,
      parameters: [idParameter],
      errors: [401, 403, 404, 500, 503],
    }),
    async (c) => {
      await users().revokeSessions(principalOf(c), c.req.raw.headers, c.req.param('id'))
      return c.json({ ok: true as const })
    },
  )

  app.put(
    '/users/:id/projects',
    documentRoute({
      tag: 'Users',
      operationId: 'setUserProjects',
      permission: 'project:members',
      summary: 'Which Projects an account reaches',
      description: 'The whole list, every time. Owner and admin see everything and are refused here.',
      request: SetUserProjects,
      response: User,
      parameters: [idParameter],
      errors: [400, 401, 403, 404, 500, 503],
    }),
    async (c) => {
      const body = SetUserProjects.parse(await c.req.json())
      return c.json(await users().setProjects(principalOf(c), c.req.param('id'), body.projects))
    },
  )

  app.post(
    '/users/:id/transfer-ownership',
    documentRoute({
      tag: 'Users',
      operationId: 'transferOwnership',
      permission: 'user:set-role',
      summary: 'Hand the panel over',
      description:
        'Only the owner, and the caller becomes an administrator in the same transaction. There is never a moment with two owners.',
      response: User,
      parameters: [idParameter],
      errors: [401, 403, 404, 500, 503],
    }),
    async (c) => c.json(await users().transferOwnership(principalOf(c), c.req.param('id'))),
  )

  return app
}
