// The first user.
//
// A panel in `protected` mode with no owner can do exactly one thing: create
// one. Everything else redirects to `/setup`, and the API answers 503
// `setup_required`, because a panel nobody can sign in to is not a panel that
// should be answering questions about the host.

import { count, eq } from 'drizzle-orm'
import { type Db, users } from 'portta-db'
import type { Auth } from './auth.ts'

export interface SetupStatus {
  mode: 'open' | 'protected'
  setupRequired: boolean
  /** Whether any user has a second factor, so the sign-in page knows what to expect. */
  twoFactor: boolean
}

export async function hasOwner(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, 'owner'))
  return (row?.n ?? 0) > 0
}

export async function setupStatus(db: Db, mode: 'open' | 'protected'): Promise<SetupStatus> {
  if (mode === 'open') return { mode, setupRequired: false, twoFactor: false }
  const [owners] = await db.select({ n: count() }).from(users).where(eq(users.role, 'owner'))
  const [factors] = await db.select({ n: count() }).from(users).where(eq(users.twoFactorEnabled, true))
  return {
    mode,
    setupRequired: (owners?.n ?? 0) === 0,
    twoFactor: (factors?.n ?? 0) > 0,
  }
}

export class SetupClosed extends Error {
  readonly status = 409

  constructor() {
    super('this installation already has an owner')
    this.name = 'SetupClosed'
  }
}

export interface BootstrapInput {
  name: string
  email: string
  password: string
}

/**
 * Create the owner, once.
 *
 * Two people opening `/setup` at the same moment produce one owner and one
 * clear refusal, and the thing that guarantees it is the database: `users` has
 * a partial unique index over `role = 'owner'`, so the second insert violates
 * it rather than succeeding.
 *
 * Not an advisory lock around a check-then-insert: SQLite transactions are
 * synchronous, so an `await` inside one runs after the commit and such a
 * "lock" would hold nothing
 * (docs/development/adr/0037-sqlite-is-the-panel-database.md). Pushing the
 * invariant into the schema is the stronger answer anyway: it holds for every
 * writer, not only for callers who remembered to take a lock.
 *
 * The check before the insert stays, because it is what turns the common case
 * — somebody opening `/setup` on an installation that already has an owner —
 * into a 409 rather than a constraint violation nobody should have to read.
 */
export async function bootstrapOwner(
  authFor: (db: Db) => Auth,
  db: Db,
  input: BootstrapInput,
  headers: Headers,
): Promise<{ user: { id: string; email: string; name: string } }> {
  if (await hasOwner(db)) throw new SetupClosed()
  try {
    // Through Better Auth, never a direct insert: the password has to be hashed
    // the way sign-in will hash it, and the `user.create` hook is what marks
    // this first account the owner.
    const created = await authFor(db).api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      headers,
      returnHeaders: true,
    })
    return { user: created.response.user }
  } catch (error) {
    if (losesTheRace(error)) throw new SetupClosed()
    throw error
  }
}

/**
 * Whether this failure is the other setup having won.
 *
 * The constraint's name is what distinguishes it from any other unique
 * violation the sign-up could hit — a duplicate email, for instance, which is a
 * different message for the person who typed it. Better Auth wraps the driver
 * error, so the whole chain is searched.
 */
function losesTheRace(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    const text =
      current instanceof Error
        ? `${current.message} ${String((current as { code?: string }).code ?? '')}`
        : String(current)
    if (text.includes('users_single_owner')) return true
    current = current instanceof Error ? (current as { cause?: unknown }).cause : null
  }
  return false
}
