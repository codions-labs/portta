// Better Auth, configured for one self-hosted installation.
//
// Built only in `protected` mode. In `open` mode it is never constructed and
// `/api/auth/*` answers 404 except for the status endpoint, because there is
// nothing to sign in to.

import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { admin, twoFactor } from 'better-auth/plugins'
import { nanoid } from 'nanoid'
import { type Db, schema } from 'portta-db'
import { ac, roles } from './access-control.ts'
import { type SecurityConfig, trustedOrigins, useSecureCookies } from './security-mode.ts'

export interface AuthDeps {
  db: Db
  security: SecurityConfig
  /** Whether this installation has an owner yet. Decides whether sign-up is open. */
  hasOwner: () => Promise<boolean>
  /**
   * How passwords are hashed and checked. Better Auth's scrypt when absent,
   * which is every panel; a suite passes something cheaper, because scrypt is
   * slow on purpose and the suites are not what it protects.
   */
  password?: {
    hash: (password: string) => Promise<string>
    verify: (data: { hash: string; password: string }) => Promise<boolean>
  }
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth(deps: AuthDeps) {
  const { db, security } = deps

  return betterAuth({
    appName: 'Portta',
    baseURL: security.panelUrl.origin,
    basePath: '/api/auth',
    secret: security.secret ?? '',
    database: drizzleAdapter(db, { provider: 'sqlite', schema, usePlural: true }),
    trustedOrigins: trustedOrigins(security),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: security.development ? 6 : 10,
      maxPasswordLength: 128,
      // The operator signs in deliberately after creating an account, so the
      // password they just typed is the one they are asked for.
      autoSignIn: false,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      // There is no mail transport in a self-hosted panel. Resetting a password
      // is `portta auth reset-password`, run on the host that owns the panel.
      sendResetPassword: async () => undefined,
      ...(deps.password ? { password: deps.password } : {}),
    },
    // Public sign-up and the email reset flow do not exist: the first user is
    // created by the bootstrap, every one after that by an administrator.
    disabledPaths: ['/sign-up/email', '/request-password-reset', '/reset-password'],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Five minutes, so a Server Component render does not query the database
      // for the session on every navigation.
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    advanced: {
      cookiePrefix: 'portta',
      useSecureCookies: useSecureCookies(security),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, path: '/' },
      database: { generateId: () => nanoid() },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      // One instance, no shared store: these are the endpoints where guessing
      // is the attack, and an in-memory window is enough to make it expensive.
      //
      // The window is per address, and a whole office behind one NAT is one
      // address — which is why the count is a setting rather than a constant.
      // Lowering it is safe; raising it is the operator saying their people
      // share an address, and it is theirs to say.
      customRules: {
        '/sign-in/email': { window: 600, max: security.signInAttempts },
        '/two-factor/verify-totp': { window: 600, max: security.signInAttempts },
        '/two-factor/verify-backup-code': { window: 600, max: security.signInAttempts },
      },
    },
    hooks: {
      // Where the refusal has to live.
      //
      // Not in `databaseHooks.user.create.before`, which is the obvious place:
      // with `autoSignIn: false` the sign-up route treats a 403 raised while
      // creating a user as "that email is taken" and answers 200 with a
      // plausible-looking user it never wrote, so that nobody can probe the
      // installation for registered addresses. Correct for a public sign-up,
      // and useless here — a caller told the account exists when it does not.
      // A request hook throws before the route, so the refusal survives.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        if (await deps.hasOwner()) {
          throw new APIError('FORBIDDEN', { message: 'Sign-up is closed; ask an administrator' })
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Two doors, and only two: the bootstrap, which runs while there is
          // no owner, and an administrator creating a user. The first account
          // is the owner; an administrator's gets the role they asked for.
          before: async (user, ctx) => {
            const viaAdmin = ctx?.path === '/admin/create-user'
            return { data: { ...user, role: viaAdmin ? ((user as { role?: string }).role ?? 'viewer') : 'owner' } }
          },
        },
      },
    },
    plugins: [
      admin({ ac, roles, adminRoles: ['owner', 'admin'], defaultRole: 'viewer' }),
      apiKey({
        // The plugin calls its model `apikey`; the adapter looks that up in the
        // Drizzle schema, and with `usePlural` it also tries `apikeys`. Portta's
        // export is `apiKeys`, so the model is named to match — the SQL table is
        // still `api_keys`, which comes from the Drizzle table itself.
        schema: { apikey: { modelName: 'apiKey' } },
        defaultPrefix: 'ptt_',
        defaultKeyLength: 32,
        enableMetadata: true,
        // Session mocking stays off (the default): the principal resolver
        // builds a token's principal itself, intersecting the token's scopes
        // with its owner's role.
        rateLimit: { enabled: false },
        keyExpiration: { defaultExpiresIn: null, minExpiresIn: 1, maxExpiresIn: 365 },
      }),
      twoFactor({ issuer: 'Portta' }),
      // Last, so `auth.api.*` called from a Server Action or a route handler can
      // still write the session cookie.
      nextCookies(),
    ],
    logger: { disabled: process.env.NODE_ENV === 'production' },
  })
}
