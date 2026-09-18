// A credential a machine carries.
//
// A token belongs to a person and never exceeds them: what it holds is the
// intersection of its own scopes and its owner's role, computed when a request
// arrives rather than when the token was made. Lowering somebody's role lowers
// every token they made, without touching the tokens; banning them stops all of
// them at once. That is the whole reason a token has an owner at all.
//
// Creation goes through the api-key plugin, which hashes the secret and is the
// only thing that knows how verification will hash it back. Listing and
// revoking are this package's own queries: the plugin's endpoints authorise
// against a session and only ever act on the caller's own keys, and Portta has
// already decided who may act on whose.

import { and, asc, desc, eq, isNotNull, lt, or } from 'drizzle-orm'
import { apiKeys, type Db, users } from 'portta-db'
import type { Role } from './access-control.ts'
import {
  AGENT_DEFAULT_PERMISSIONS,
  fromStatements,
  isPermission,
  type Permission,
  permissionsOf,
  toStatements,
} from './access-control.ts'
import type { Auth } from './auth.ts'

/** The prefix every Portta token carries, so a scanner can find one. */
export const TOKEN_PREFIX = 'ptt_'

export class TokenRefused extends Error {
  readonly status = 400
  readonly hint: string

  constructor(message: string, hint = 'a token can never hold more than its owner') {
    super(message)
    this.name = 'TokenRefused'
    this.hint = hint
  }
}

export interface TokenRecord {
  id: string
  name: string
  /** The first characters, so a listing can identify one without the secret. */
  start: string | null
  actor: string
  actorKind: 'human' | 'agent'
  scopes: Permission[]
  createdAt: Date
  expiresAt: Date | null
  lastUsedAt: Date | null
  enabled: boolean
  userId: string
  userEmail: string
}

export interface CreateTokenInput {
  userId: string
  name: string
  actorKind?: 'human' | 'agent'
  /** Absent means the default for the kind, narrowed by the owner's role. */
  scopes?: readonly string[]
  /** 1 to 365. Absent means no expiry: it is valid until revoked. */
  expiresInDays?: number
}

/**
 * What a new token holds.
 *
 * Nothing given means the sensible default for what it is: a person's token is
 * their whole role, because it is them; an agent's is what agents hold, because
 * an agent left running for a month should not be able to destroy an
 * environment on a typo. Anything given has to fit inside the role, and the
 * refusal names exactly what did not fit — "invalid scopes" sends somebody
 * comparing two lists by hand.
 */
export function scopesFor(
  role: Role,
  input: { actorKind?: 'human' | 'agent'; scopes?: readonly string[] },
): Permission[] {
  const held = permissionsOf(role)
  if (!input.scopes) {
    if (input.actorKind === 'human') return [...held].sort()
    return AGENT_DEFAULT_PERMISSIONS.filter((permission) => held.has(permission)).sort()
  }

  const unknown = input.scopes.filter((scope) => !isPermission(scope))
  if (unknown.length > 0) {
    throw new TokenRefused(
      `not a permission: ${unknown.sort().join(', ')}`,
      'see x-portta-permission in the OpenAPI document',
    )
  }
  const wanted = input.scopes as readonly Permission[]
  const beyond = wanted.filter((permission) => !held.has(permission))
  if (beyond.length > 0) {
    throw new TokenRefused(`a ${role} does not hold ${[...beyond].sort().join(', ')}`)
  }
  return [...new Set(wanted)].sort()
}

function toRecord(row: typeof apiKeys.$inferSelect, user: { id: string; email: string }): TokenRecord {
  const metadata = parseMetadata(row.metadata)
  return {
    id: row.id,
    name: row.name ?? 'token',
    start: row.start,
    actor: metadata.actor ?? user.email,
    actorKind: metadata.actorKind === 'human' ? 'human' : 'agent',
    scopes: fromStatements(parseScopes(row.permissions)),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastRequest,
    enabled: row.enabled === true && (row.expiresAt === null || row.expiresAt.getTime() > Date.now()),
    userId: user.id,
    userEmail: user.email,
  }
}

/** The plugin stores both of these as text. A malformed one is not a crash. */
function parseMetadata(raw: string | null): { actor?: string; actorKind?: string } {
  if (!raw) return {}
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' ? (parsed as { actor?: string; actorKind?: string }) : {}
  } catch {
    return {}
  }
}

function parseScopes(raw: string | null): Record<string, string[]> | null {
  if (!raw) return null
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : null
  } catch {
    return null
  }
}

export interface TokenDeps {
  db: Db
  auth: Auth
}

export async function createToken(
  deps: TokenDeps,
  input: CreateTokenInput,
): Promise<{ token: string; record: TokenRecord }> {
  const [user] = await deps.db.select().from(users).where(eq(users.id, input.userId))
  if (!user) throw new TokenRefused(`no user '${input.userId}'`, 'a token belongs to a person')
  if (user.banned === true) throw new TokenRefused('that account is banned', 'unban it first')

  const actorKind = input.actorKind ?? 'agent'
  const scopes = scopesFor(user.role as Role, { ...(input.scopes ? { scopes: input.scopes } : {}), actorKind })
  if (input.expiresInDays !== undefined && (input.expiresInDays < 1 || input.expiresInDays > 365)) {
    throw new TokenRefused('an expiry is between 1 and 365 days', 'omit it for a token that is valid until revoked')
  }

  // Server-side, with no headers: the plugin's endpoint only accepts `userId`
  // and `permissions` from inside the process, which is exactly where Portta
  // has already decided who this is for and what it may hold.
  const created = await deps.auth.api.createApiKey({
    body: {
      userId: user.id,
      name: input.name,
      prefix: TOKEN_PREFIX,
      permissions: toStatements(scopes),
      metadata: { actor: input.name, actorKind, source: 'api' },
      ...(input.expiresInDays === undefined ? {} : { expiresIn: input.expiresInDays * 24 * 60 * 60 }),
    },
  })

  const [row] = await deps.db.select().from(apiKeys).where(eq(apiKeys.id, created.id))
  if (!row) throw new TokenRefused('the token was created but could not be read back')
  return { token: created.key, record: toRecord(row, user) }
}

/**
 * Somebody's tokens, or everybody's.
 *
 * Never the secret: `key` is a hash and never leaves the database. `start` is
 * the first characters, which is enough for a person to recognise the one they
 * are looking at and useless to anybody who finds the listing.
 */
export async function listTokens(db: Db, options: { userId?: string } = {}): Promise<TokenRecord[]> {
  const rows = await db
    .select({ token: apiKeys, user: { id: users.id, email: users.email } })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.referenceId))
    .where(options.userId ? eq(apiKeys.referenceId, options.userId) : undefined)
    .orderBy(desc(apiKeys.createdAt), asc(apiKeys.id))
  return rows.map((row) => toRecord(row.token, row.user))
}

export async function findToken(db: Db, id: string): Promise<TokenRecord | null> {
  const rows = await db
    .select({ token: apiKeys, user: { id: users.id, email: users.email } })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.referenceId))
    .where(eq(apiKeys.id, id))
  const row = rows[0]
  return row ? toRecord(row.token, row.user) : null
}

/**
 * Stop a token working, now.
 *
 * Disabled *and* expired in the past: either alone would do it, and writing
 * both means a revoked token is refused by the plugin's own check as well as by
 * Portta's, whichever runs first. The row stays so a listing can still say what
 * was revoked and when.
 */
export async function revokeToken(db: Db, id: string, now = new Date()): Promise<boolean> {
  const updated = await db
    .update(apiKeys)
    .set({ enabled: false, expiresAt: now, updatedAt: now })
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id })
  return updated.length > 0
}

/**
 * Housekeeping, on the schedule ADR 0039 sets: a token that expired more than
 * thirty days ago is disabled, and one revoked more than ninety days ago is
 * deleted. Nothing here can end a token somebody is still using.
 */
export async function collectTokens(db: Db, now = new Date()): Promise<{ disabled: number; removed: number }> {
  const thirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDays = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  const disabled = await db
    .update(apiKeys)
    .set({ enabled: false, updatedAt: now })
    .where(and(eq(apiKeys.enabled, true), isNotNull(apiKeys.expiresAt), lt(apiKeys.expiresAt, thirtyDays)))
    .returning({ id: apiKeys.id })

  const removed = await db
    .delete(apiKeys)
    .where(
      and(
        eq(apiKeys.enabled, false),
        or(isNotNull(apiKeys.expiresAt), isNotNull(apiKeys.updatedAt)),
        lt(apiKeys.updatedAt, ninetyDays),
      ),
    )
    .returning({ id: apiKeys.id })

  return { disabled: disabled.length, removed: removed.length }
}
