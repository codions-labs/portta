// A panel's authentication, in memory.
//
// An in-memory SQLite with the real migrations, and a real Better Auth over
// it: what these
// suites exercise is the library's own behaviour against Portta's schema, which
// is the only way to find out that a column is missing or a hook never fires.
//
// One database per file, emptied whenever a test asks for a harness, and one
// Better Auth per configuration. Passwords are hashed with SHA-256 unless a test
// asks for the real thing: scrypt is slow on purpose, and one test proves the
// bootstrap and sign-in agree on it.

import { createHash } from 'node:crypto'
import type { Db } from 'portta-db'
import { createTestDb, resetTestDb, type TestDatabase } from 'portta-db/testing'
import { afterAll } from 'vitest'
import type { Permission } from '../src/access-control.ts'
import { type Auth, createAuth } from '../src/auth.ts'
import { hasOwner } from '../src/bootstrap.ts'
import { createPrincipalResolver, type PrincipalResolver } from '../src/principal.ts'
import { resolveSecurityMode, type SecurityConfig } from '../src/security-mode.ts'

export interface Harness {
  db: Db
  auth: Auth
  /** Better Auth over any handle, which is how the bootstrap reaches into its transaction. */
  authFor: (db: Db) => Auth
  security: SecurityConfig
  resolver: PrincipalResolver
}

export interface HarnessOptions {
  mode?: 'open' | 'protected'
  readOnly?: boolean
  development?: boolean
  agentPermissions?: readonly Permission[]
  /** Better Auth's own scrypt instead of the cheap test hash. */
  realPasswords?: boolean
}

const digest = (password: string) => `sha256:${createHash('sha256').update(password).digest('hex')}`

export const cheapPasswords = {
  hash: async (password: string) => digest(password),
  verify: async ({ hash, password }: { hash: string; password: string }) => hash === digest(password),
}

let shared: Promise<TestDatabase> | undefined
const auths = new Map<string, Auth>()

afterAll(async () => {
  await (await shared)?.close()
  shared = undefined
  auths.clear()
})

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  shared ??= createTestDb()
  const { db } = await shared
  await resetTestDb(db)
  const security = resolveSecurityMode(
    options.mode === 'protected'
      ? {
          PORTTA_AUTH_MODE: 'required',
          PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
          ...(options.readOnly ? { PORTTA_RUNTIME_READ_ONLY: 'true' } : {}),
          ...(options.development ? { PORTTA_WEB_DEV: 'true' } : {}),
        }
      : options.readOnly
        ? { PORTTA_RUNTIME_READ_ONLY: 'true', ...(options.development ? { PORTTA_WEB_DEV: 'true' } : {}) }
        : options.development
          ? { PORTTA_WEB_DEV: 'true' }
          : {},
  )

  const handle = db as unknown as Db
  const password = options.realPasswords ? {} : { password: cheapPasswords }
  const authFor = (on: Db) => createAuth({ db: on, security, hasOwner: () => hasOwner(on), ...password })
  const key = JSON.stringify([options.mode, options.readOnly, options.development, options.realPasswords])
  let auth = auths.get(key)
  if (!auth) {
    auth = authFor(handle)
    auths.set(key, auth)
  }
  const resolver = createPrincipalResolver({
    security,
    db: handle,
    auth: security.mode === 'protected' ? auth : null,
    ...(options.agentPermissions ? { agentPermissions: async () => options.agentPermissions! } : {}),
  })

  return { db: handle, auth, authFor, security, resolver }
}

/** Sign in, and hand back the cookie the browser would send next time. */
export async function signIn(auth: Auth, email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  const cookie = response.headers.get('set-cookie')
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie.split(';')[0] ?? '')
  return headers
}

export function bearer(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` })
}
