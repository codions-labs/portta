// What was done, by whom, to what.
//
// Not a log and not a work record: `activity_events` already says what happened
// in the development flow, and issues and sessions belong there. This is the
// sensitive writes — who signed in, who changed a role, who destroyed an
// environment — so an operator can answer "who did that" months later.
//
// Written by the services, after the write they record has succeeded, and read
// by one route and one Settings page (ADR 0013).

import { and, desc, eq, lt } from 'drizzle-orm'
import type { Principal } from 'portta-auth-core'
import type { AuditAction } from 'portta-core'
import { auditLog, type Db, projects as projectsTable } from 'portta-db'

export type { AuditAction }

export interface AuditEntry {
  id: string
  at: number
  /** Null once the account is removed; `userEmail` keeps the line readable. */
  userId: string | null
  userEmail: string | null
  principalKind: 'local' | 'user' | 'token'
  actor: string
  action: AuditAction
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  project: string | null
  ipAddress: string | null
  metadata: Record<string, unknown>
}

export interface AuditQuery {
  limit?: number
  /** An id; only entries older than it, for paging. */
  before?: string
  userId?: string
  projectId?: number
  action?: AuditAction
}

/**
 * The entries, newest first.
 *
 * Read straight from the table rather than through a repository: the audit log
 * is one shape with one query, and a repository over it would be a layer with
 * one method in it.
 */
export async function listAudit(
  db: Db,
  query: AuditQuery = {},
): Promise<{ entries: AuditEntry[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500)
  const filters = [
    ...(query.before ? [lt(auditLog.id, Number(query.before))] : []),
    ...(query.userId ? [eq(auditLog.userId, query.userId)] : []),
    ...(query.projectId ? [eq(auditLog.projectId, query.projectId)] : []),
    ...(query.action ? [eq(auditLog.action, query.action)] : []),
  ]

  const rows = await db
    .select({ entry: auditLog, projectSlug: projectsTable.slug })
    .from(auditLog)
    .leftJoin(projectsTable, eq(projectsTable.id, auditLog.projectId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLog.id))
    // One more than asked for, so "is there another page" is an answer rather
    // than a second count query.
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  return {
    entries: page.map((row) => ({
      id: String(row.entry.id),
      at: Math.floor(row.entry.at.getTime() / 1000),
      userId: row.entry.userId,
      userEmail: row.entry.userEmail,
      principalKind: row.entry.principalKind,
      actor: row.entry.actor,
      action: row.entry.action as AuditAction,
      resourceType: row.entry.resourceType,
      resourceId: row.entry.resourceId,
      resourceName: row.entry.resourceName,
      project: row.projectSlug,
      ipAddress: row.entry.ipAddress,
      metadata: row.entry.metadata,
    })),
    nextBefore: rows.length > limit ? String(page.at(-1)?.entry.id ?? '') : null,
  }
}

/** What a caller says happened. Everything else is taken from the principal. */
export interface AuditInput {
  action: AuditAction
  /** `user`, `token`, `project`, `environment`… — what kind of thing this was. */
  resourceType: string
  resourceId?: string | null
  /** The name a person would recognise: an email, a slug, a container name. */
  resourceName?: string | null
  projectId?: number | null
  /** Never a request body, a password, a hash, a token or an environment value. */
  metadata?: Record<string, unknown>
}

/**
 * Values that must never reach the log, whatever a caller passes.
 *
 * The rule is in ADR 0013 and this is the second half of enforcing it: callers
 * pass small, chosen objects, and this refuses the shapes that carry a secret
 * anyway — a `ptt_` token pasted into a name, a key called `password`, a hash.
 * It redacts rather than throws: an audit line that is missing one field is
 * worth more than an audit line that was never written.
 */
// Two shapes, because a field is named both ways: `api_key` and `apiKey`. The
// second is case-sensitive on purpose — `monkey` ends in `key` and is not a
// secret, while `apiKey` is.
const SNAKE_SECRET = /(^|[_-])(password|passphrase|secret|token|hash|key|credential|authorization|cookie)s?$/i
const CAMEL_SECRET = /[a-z0-9](Password|Passphrase|Secret|Token|Hash|Key|Credential|Authorization|Cookie)s?$/

function isSecretKey(key: string): boolean {
  return SNAKE_SECRET.test(key) || CAMEL_SECRET.test(key)
}
const SECRET_VALUES = /(ptt_[A-Za-z0-9_-]{4,}|\$portta\$scrypt\$|-----BEGIN)/

function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return SECRET_VALUES.test(value) ? '[redacted]' : value.slice(0, 512)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 3) return '[deep]'
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => scrub(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 32)
        .map(([key, item]) => [key, isSecretKey(key) ? '[redacted]' : scrub(item, depth + 1)]),
    )
  }
  return undefined
}

export function scrubMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return scrub(metadata) as Record<string, unknown>
}

/**
 * Record that something sensitive happened.
 *
 * Called by services rather than by routes, after the write succeeded, and on
 * the transaction handle when there is one — so a rolled-back change leaves no
 * line claiming it happened.
 *
 * It never throws. A panel that refused a legitimate write because its audit
 * insert failed would be a panel that stops working when a disk fills up, and
 * the log is a record of what the panel did, not a condition of doing it. A
 * failure is reported on stderr, where the rest of the panel's degradations go.
 */
export async function audit(db: Db, principal: Principal, entry: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: principal.userId,
      userEmail: principal.email,
      principalKind: principal.kind,
      actor: principal.actor,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      resourceName: entry.resourceName ?? null,
      projectId: entry.projectId ?? null,
      ipAddress: principal.ip,
      metadata: scrubMetadata(entry.metadata ?? {}),
    })
  } catch (cause) {
    console.error(`audit not recorded (${entry.action}): ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/**
 * Forget entries older than the retention window.
 *
 * Six months: long enough to answer "who did that" about something noticed a
 * quarter later, short enough that the table is not an unbounded record of a
 * development host. Runs from the maintenance job, beside the token cleanup.
 */
export const AUDIT_RETENTION_DAYS = 180

export async function collectAudit(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const removed = await db.delete(auditLog).where(lt(auditLog.at, cutoff)).returning({ id: auditLog.id })
  return removed.length
}
