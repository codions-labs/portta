import { documentationRoutes } from './routes/documentation.ts'
// The panel's HTTP surface: a small API, and the built UI beside it.

import { type ErrorHandler, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Forbidden, hasOwner, TokenRefused, Unauthenticated } from 'portta-auth-core'
import { principalMiddleware, SetupRequired } from 'portta-auth-core/hono'
import { ZodError } from 'zod'
import { DatabaseUnavailable } from '../db/index.ts'
import type { AppDeps } from '../deps.ts'
import { mountModuleRoutes, SERVER_MODULES } from '../modules/index.ts'
import { originAllowed } from '../origin.ts'
import { eventRoutes } from '../realtime/sse.ts'
import { AccessError } from '../services/access.ts'
import { ActionRefused } from '../services/actions.ts'
import { AUDITED_AUTH_PATHS, auditAuthExchange } from '../services/audit-auth.ts'
import { DockerAccessDenied } from '../services/docker/allowlist.ts'
import { DockerApiError } from '../services/docker/client.ts'
import { DynamicWriteRefused } from '../services/dynamic.ts'
import { FORGE_HTTP_STATUS, ForgeUnavailable } from '../services/issues/host-client.ts'
import { OverrideRefused } from '../services/overrides.ts'
import { ValidationError } from '../services/settings.ts'
import { ShareRefused } from '../services/shares.ts'
import { SshKeyRefused } from '../services/ssh-keys.ts'
import { UnknownUser, UserRefused, UsersUnavailable } from '../services/users.ts'
import { registerOpenApiRoutes } from './openapi.ts'
import { accessRoutes } from './routes/access.ts'
import { activityRoutes } from './routes/activity.ts'
import { auditRoutes } from './routes/audit.ts'
import { authRoutes } from './routes/auth.ts'
import { configRoutes } from './routes/config.ts'
import { databaseRoutes } from './routes/database.ts'
import { developmentRoutes } from './routes/development.ts'
import { dockerRoutes } from './routes/docker.ts'
import { environmentRoutes } from './routes/environments.ts'
import { gatewayRoutes } from './routes/gateway.ts'
import { hostRoutes } from './routes/host.ts'
import { issueRoutes } from './routes/issues.ts'
import { mcpRoutes } from './routes/mcp.ts'
import { networkRoutes } from './routes/network.ts'
import { overrideRoutes } from './routes/overrides.ts'
import { projectRoutes } from './routes/projects.ts'
import { repositoryRoutes } from './routes/repositories.ts'
import { runnerRoutes } from './routes/runner.ts'
import { serviceRoutes } from './routes/services.ts'
import { sessionRoutes } from './routes/sessions.ts'
import { settingsRoutes } from './routes/settings.ts'
import { shareRoutes } from './routes/shares.ts'
import { sshRoutes } from './routes/ssh.ts'
import { statusRoutes } from './routes/status.ts'
import { tokenRoutes } from './routes/tokens.ts'
import { tunnelRoutes } from './routes/tunnel.ts'
import { userRoutes } from './routes/users.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * What answers without a credential.
 *
 * Three routes, named in full because the set is the security boundary: adding
 * to it is a decision, and reading it should not require reading the routers.
 * Liveness, the status a browser needs before it knows which page to show, and
 * the bootstrap that has nobody to authenticate as yet. Portta mirrors nothing
 * from a provider, so no delivery endpoint answers without a session (ADR 0018).
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/setup',
])

/**
 * The paths under `/api/auth` that are Portta's, not Better Auth's.
 *
 * Everything else there is handed to the library untouched. Naming ours is what
 * keeps that hand-off total: a path that is not in this set is the library's,
 * whatever it is called and whenever it was added.
 */
const PORTTA_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/me',
  '/api/auth/tokens',
])

/** Ours, or the library's. `/tokens/:id` is ours too, hence the prefix. */
function isPorttaAuthPath(path: string): boolean {
  return PORTTA_AUTH_PATHS.has(path) || path.startsWith('/api/auth/tokens/')
}

export function createApi(deps: AppDeps): Hono {
  const api = new Hono()
  // The API's own answers to its own failures, so a request that re-enters it
  // from inside the process (the MCP transport) gets the same JSON a client
  // over the wire gets. Mounted under `createApp`, this handler is the one
  // Hono keeps for these routes; it is the same function either way.
  api.onError(handleError)

  // Better Auth's own endpoints, before the principal is resolved: sign-in has
  // nobody to be yet. The request is handed over as it arrived and the library's
  // response is returned as it came back, cookies and all, because that contract
  // is the library's to define.
  //
  // In open mode `deps.auth` is null and this never registers, so `/api/auth/*`
  // falls through to the 404 at the bottom -- except for the two of ours that
  // still answer, which is what a browser needs to learn there is no sign-in.
  const auth = deps.auth
  if (auth) {
    api.use('/auth/*', async (c, next) => {
      if (isPorttaAuthPath(c.req.path)) return next()
      // The request is read twice: once here, to know which email a failed
      // sign-in was for, and once by the library. `c.req.raw` is cloned rather
      // than consumed, because a body read to the end is a body the handler
      // would receive empty.
      const body =
        c.req.method === 'POST'
          ? await c.req.raw
              .clone()
              .json()
              .catch(() => null)
          : null
      const response = await auth.handler(c.req.raw)
      // The audit line is written from a copy for the same reason.
      const seen = AUDITED_AUTH_PATHS.has(c.req.path)
      const answered = seen
        ? ((await response
            .clone()
            .json()
            .catch(() => null)) as { user?: { id: string; email: string; name: string } } | null)
        : null
      if (seen) {
        void auditAuthExchange(deps.db.handle, {
          path: c.req.path,
          status: response.status,
          body,
          headers: c.req.raw.headers,
          user: answered?.user ?? null,
        })
      }
      return response
    })
  }

  // Who is asking, before any route: in open mode the local operator, narrowed
  // to what agents hold when the request says it is one; in protected mode a
  // session cookie or a Portta token, and nothing at all without one.
  api.use(
    '*',
    principalMiddleware({
      resolver: deps.principals,
      publicRoutes: PUBLIC_ROUTES,
      setupRequired: deps.security.mode === 'open' ? undefined : async () => !(await hasOwner(deps.db.handle)),
    }),
  )

  api.use('*', async (c, next) => {
    c.header('cache-control', 'no-store')
    c.header('x-content-type-options', 'nosniff')

    if (!SAFE_METHODS.has(c.req.method)) {
      // Applying pending SQL is what boot already does. Read-only forbids
      // operator writes, not bringing the schema current.
      const isSchemaMigrate = c.req.path.endsWith('/database/migrate')
      if (deps.config.readOnly && !isSchemaMigrate) {
        throw new HTTPException(403, { message: 'the panel is running in read-only mode' })
      }
      // Nothing is exempt from this guard: there is no unauthenticated write
      // to make an exception for (ADR 0018).
      const origin = c.req.header('origin') ?? ''
      const host = c.req.header('host') ?? ''
      if (!originAllowed(origin, host, deps.security.trustedOrigins)) {
        throw new HTTPException(403, { message: 'cross-origin writes are refused' })
      }
    }
    await next()
  })

  api.route('/', statusRoutes(deps))
  api.route('/', environmentRoutes(deps))
  api.route('/', runnerRoutes(deps))
  api.route('/', overrideRoutes(deps))
  api.route('/', projectRoutes(deps))
  api.route('/', repositoryRoutes(deps))
  api.route('/', serviceRoutes(deps))
  api.route('/', dockerRoutes(deps))
  api.route('/', networkRoutes(deps))
  api.route('/', tunnelRoutes(deps))
  api.route('/', accessRoutes(deps))
  api.route('/', shareRoutes(deps))
  api.route('/', gatewayRoutes(deps))
  api.route('/', hostRoutes(deps))
  api.route('/', configRoutes(deps))
  api.route('/', databaseRoutes(deps))
  api.route('/', eventRoutes(deps))
  api.route('/', issueRoutes(deps))
  api.route('/', sessionRoutes(deps))
  api.route('/', activityRoutes(deps))
  api.route('/', developmentRoutes(deps))
  api.route('/', authRoutes(deps))
  api.route('/', userRoutes(deps))
  api.route('/', tokenRoutes(deps))
  api.route('/', auditRoutes(deps))
  api.route('/', settingsRoutes(deps))
  api.route('/', documentationRoutes(deps))
  api.route('/', sshRoutes(deps))
  // After every base route, so a module can only add paths under its own prefix.
  mountModuleRoutes(api, deps, deps.modules ?? SERVER_MODULES)
  // After the modules, because it serves their tools; and only when asked for.
  if (deps.config.mcpHttp) mcpRoutes(deps, api)
  registerOpenApiRoutes(api, deps.config)

  api.all('*', (c) => c.json({ error: `no such endpoint: ${c.req.path}` }, 404))

  return api
}

/** A SQLite UNIQUE or PRIMARY KEY failure, however many wrappers the driver put around it. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth += 1) {
    const code = (current as { code?: unknown }).code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true
  }
  return false
}

/** How a failure becomes an answer: one handler, for the API and for what re-enters it. */
const handleError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }
  // The distinction is the contract: 401 means "say who you are", 403 means
  // "you did, and it is not enough". A client that cannot tell them apart
  // either retries forever or gives up on a credential that was fine.
  if (error instanceof Unauthenticated) {
    return c.json({ error: error.message, hint: 'sign in, or send a Portta token' }, 401)
  }
  if (error instanceof Forbidden) {
    return c.json({ error: error.message, hint: `this needs ${error.permission}` }, 403)
  }
  // A panel with no owner answers nothing about the host it runs on.
  if (error instanceof SetupRequired) {
    return c.json({ error: error.message, code: 'setup_required', hint: 'open /setup to create the owner' }, 503)
  }
  if (
    error instanceof ActionRefused ||
    error instanceof AccessError ||
    error instanceof ShareRefused ||
    error instanceof OverrideRefused ||
    error instanceof DynamicWriteRefused ||
    error instanceof SshKeyRefused
  ) {
    return c.json({ error: error.message, hint: error.hint }, error.status as 400)
  }
  // A token asking for more than its owner holds is the caller's mistake, and
  // the message names exactly what did not fit.
  if (error instanceof TokenRefused) {
    return c.json({ error: error.message, hint: error.hint }, 400)
  }
  // A rule about accounts, not a missing permission: the message says which
  // rule, because "403" alone sends somebody looking for the wrong thing.
  if (error instanceof UserRefused) {
    return c.json({ error: error.message, hint: error.hint }, 403)
  }
  if (error instanceof UnknownUser) {
    return c.json({ error: error.message }, 404)
  }
  if (error instanceof UsersUnavailable) {
    return c.json({ error: error.message, hint: error.hint }, 503)
  }
  if (error instanceof ValidationError) {
    return c.json({ error: error.message, hint: 'the value was not saved' }, 400)
  }
  // A body that does not match its schema is the caller's mistake, not a
  // server failure. It reached the 500 branch before, which told an agent to
  // retry something that will never succeed.
  if (error instanceof ZodError) {
    return c.json(
      {
        error: error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '),
        hint: 'the request body did not match the documented schema',
      },
      400,
    )
  }
  // A unique index is the database saying the thing already exists. Most
  // routes ask first; the ones that let the index decide would otherwise
  // report a caller's duplicate as a server failure.
  if (isUniqueViolation(error)) {
    return c.json({ error: 'it already exists', hint: 'choose another name, or use the existing one' }, 409)
  }
  if (error instanceof DatabaseUnavailable) {
    return c.json(
      { error: error.message, hint: 'existing Docker-backed pages remain available; run portta db status' },
      503,
    )
  }
  // A provider degrades the way the database does, and each way it can
  // degrade keeps its own status: "gh is not installed", "nobody is signed
  // in", "this account cannot see that repository" and "GitHub is
  // rate-limiting you" are four different things to fix.
  if (error instanceof ForgeUnavailable) {
    return c.json({ error: error.message, hint: error.hint }, FORGE_HTTP_STATUS[error.kind])
  }
  if (error instanceof DockerAccessDenied) {
    return c.json({ error: error.message, hint: 'this is a panel limit, not a Docker one' }, 403)
  }
  if (error instanceof DockerApiError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502
    return c.json({ error: error.message }, status as 502)
  }
  return c.json({ error: 'unexpected failure', detail: String(error) }, 500)
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  app.onError(handleError)

  // `/api` and nothing else. The documentation is a route of the panel now
  // (`app/docs`), and everything that is not the API reaches Next through the
  // dispatcher in apps/web/server/compose.ts.
  app.route('/api', createApi(deps))
  return app
}

export type { AppDeps }
