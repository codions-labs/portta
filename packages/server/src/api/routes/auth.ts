// Signing in, and the two questions that can be asked before you have.
//
// Three routes are Portta's own: the status a browser reads before deciding
// which page to show, the bootstrap that creates the owner, and `me`, which
// says who the request turned out to be. Everything else under `/api/auth`
// belongs to Better Auth and is handed to it verbatim, so its endpoints,
// cookies and error shapes stay exactly what the library documents.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bootstrapOwner, createAuth, hasOwner, SetupClosed, setupStatus } from 'portta-auth-core'
import { principalOf } from 'portta-auth-core/hono'
import { z } from 'portta-core/zod'
import type { Db } from 'portta-db'
import type { AppDeps } from '../../deps.ts'
import { documentRoute } from '../openapi.ts'

/** Development accepts the well-known six-character demo password; installations do not. */
const DevSetupPassword = z.string().min(6).max(128)

const AuthStatus = z
  .object({
    mode: z.enum(['open', 'protected']),
    setupRequired: z.boolean(),
    twoFactor: z.boolean(),
  })
  .strict()
  .meta({ ref: 'AuthStatus' })

const Setup = z
  .object({
    name: z.string().min(1).max(120),
    email: z.email(),
    // Better Auth is configured for ten on an installation, and refusing here
    // means the refusal names the field rather than arriving as a library error.
    password: z.string().min(10).max(128),
  })
  .strict()
  .meta({ ref: 'AuthSetup' })

const DevSetup = z
  .object({
    name: z.string().min(1).max(120),
    email: z.email(),
    password: DevSetupPassword,
  })
  .strict()

const SetupResult = z
  .object({
    ok: z.literal(true),
    user: z.object({ id: z.string(), email: z.string(), name: z.string() }).strict(),
  })
  .strict()
  .meta({ ref: 'AuthSetupResult' })

const Me = z
  .object({
    kind: z.enum(['local', 'user', 'token']),
    userId: z.string().nullable(),
    name: z.string(),
    email: z.string().nullable(),
    role: z.enum(['owner', 'admin', 'developer', 'viewer']),
    actor: z.string(),
    actorKind: z.enum(['human', 'agent']),
    permissions: z.array(z.string()),
    /** `all`, or the ids of the projects this principal is a member of. */
    scope: z.union([z.literal('all'), z.array(z.number())]),
    /** The Projects this request can open, by slug. `all` means every one there is. */
    projects: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() }).strict()),
    tokenId: z.string().nullable(),
  })
  .strict()
  .meta({ ref: 'Me' })

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  const mode = deps.security.mode

  app.get(
    '/auth/status',
    documentRoute({
      tag: 'Authentication',
      operationId: 'getAuthStatus',
      public: true,
      summary: 'Whether this panel asks who you are, and whether it has an owner yet',
      description:
        'Public, and the only thing a panel without an owner will answer besides liveness: the pages need it to decide between /setup, /sign-in and the panel itself.',
      response: AuthStatus,
      errors: [500, 503],
    }),
    async (c) => c.json(await setupStatus(deps.db.handle, mode)),
  )

  app.post(
    '/auth/setup',
    documentRoute({
      tag: 'Authentication',
      operationId: 'createOwner',
      public: true,
      summary: 'Create the first user, who becomes the owner',
      description:
        'Accepted only while there is no owner. Two requests at once produce one owner and one 409, not two owners.',
      request: Setup,
      response: SetupResult,
      status: 201,
      errors: [400, 403, 404, 409, 500, 503],
    }),
    async (c) => {
      // In open mode there is nobody to be: every request is already the local
      // operator, and an owner would be a credential that decides nothing.
      if (mode === 'open') throw new HTTPException(404, { message: 'this panel does not sign people in' })
      const raw = await c.req.json()
      const body = deps.security.development ? DevSetup.parse(raw) : Setup.parse(raw)
      try {
        const created = await bootstrapOwner(
          (handle: Db) => createAuth({ ...authOptions(deps), db: handle }),
          deps.db.handle,
          body,
          c.req.raw.headers,
        )
        return c.json({ ok: true as const, user: created.user }, 201)
      } catch (error) {
        if (error instanceof SetupClosed) throw new HTTPException(409, { message: error.message })
        throw error
      }
    },
  )

  app.get(
    '/auth/me',
    documentRoute({
      tag: 'Authentication',
      operationId: 'getMe',
      authenticated: true,
      summary: 'Who this request is, and what it may do',
      description: 'What `portta auth status` prints and what the panel uses to decide which controls to show.',
      response: Me,
      errors: [401, 500],
    }),
    async (c) => {
      const principal = principalOf(c)
      // Named, not just numbered: `portta auth status` and the panel both want to
      // print what somebody can open, and an id says nothing to a person.
      const rows = await deps.db.projects.list().catch(() => [])
      const reachable = rows.filter((row) => principal.scope === 'all' || principal.scope.has(Number(row.id)))
      return c.json({
        kind: principal.kind,
        userId: principal.userId,
        name: principal.name,
        email: principal.email,
        role: principal.role,
        actor: principal.actor,
        actorKind: principal.actorKind,
        permissions: [...principal.permissions].sort(),
        scope: principal.scope === 'all' ? ('all' as const) : [...principal.scope].sort((a, b) => a - b),
        projects: reachable.map((row) => ({ id: row.id, slug: row.slug, name: row.name })),
        tokenId: principal.tokenId,
      })
    },
  )

  return app
}

/** The options `createAuth` needs, minus the handle the caller chooses. */
function authOptions(deps: AppDeps) {
  return { security: deps.security, hasOwner: () => hasOwner(deps.db.handle) }
}
