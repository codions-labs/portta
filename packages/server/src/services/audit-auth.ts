// The session events, recorded where Better Auth is mounted.
//
// Everywhere else the audit line is written by the service that made the
// change, which is the rule: the record belongs beside the write it records.
// These endpoints have no Portta service behind them — signing in, signing
// out, turning on a second factor and changing your own password are the
// library's, and reimplementing them to get a log line would be the worst
// possible reason to reimplement them.
//
// So this observes the exchange instead: the path that was called, the status
// that came back, and nothing else. A failed sign-in records the address and
// the email that was tried, because that is the line somebody reads after a
// break-in attempt; it records no password, and it says nothing about whether
// the address exists.

import type { Principal } from 'portta-auth-core'
import type { AuditAction } from 'portta-core'
import type { Db } from 'portta-db'
import { audit } from './audit.ts'

/** Which endpoint means what, when it succeeds. */
const ON_SUCCESS: Record<string, AuditAction> = {
  '/api/auth/sign-in/email': 'auth.login',
  '/api/auth/sign-out': 'auth.logout',
  '/api/auth/two-factor/verify-totp': 'auth.login',
  '/api/auth/two-factor/verify-backup-code': 'auth.login',
  '/api/auth/two-factor/enable': 'user.two_factor_enabled',
  '/api/auth/two-factor/disable': 'user.two_factor_disabled',
  '/api/auth/change-password': 'user.password_changed',
}

/** The one failure worth a line: somebody tried a password and it was wrong. */
const ON_FAILURE: Record<string, AuditAction> = {
  '/api/auth/sign-in/email': 'auth.login_failed',
}

/**
 * The paths worth looking at, so every other auth request is untouched.
 *
 * Reading a response body to write a log line is not free, and most of these
 * endpoints — a session check on every page, a listing — are not events.
 */
export const AUDITED_AUTH_PATHS: ReadonlySet<string> = new Set([...Object.keys(ON_SUCCESS), ...Object.keys(ON_FAILURE)])

function addressOf(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip')?.trim() || null
}

/**
 * A principal for somebody the panel has not identified yet.
 *
 * A failed sign-in has no session and no account, so the line it writes names
 * the email that was tried and nothing else. `kind: 'user'` because that is
 * what the attempt was, not what it achieved.
 */
function attempted(email: string | null, ip: string | null): Principal {
  return {
    kind: 'user',
    userId: null,
    name: email ?? 'unknown',
    email,
    role: 'viewer',
    permissions: new Set(),
    scope: new Set(),
    actor: email ?? 'unknown',
    actorKind: 'human',
    source: 'web',
    sessionId: null,
    tokenId: null,
    ip,
  }
}

/** The email a sign-in attempt was for, from a body that may be anything. */
function emailOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const email = (body as { email?: unknown }).email
  return typeof email === 'string' && email.length <= 320 ? email : null
}

export interface AuthExchange {
  path: string
  status: number
  /** The parsed request body, when the caller sent JSON. Never stored. */
  body: unknown
  headers: Headers
  /** Who the request turned out to be, when the library said. */
  user: { id: string; email: string; name: string } | null
}

export async function auditAuthExchange(db: Db, exchange: AuthExchange): Promise<void> {
  const ok = exchange.status >= 200 && exchange.status < 300
  const action = ok ? ON_SUCCESS[exchange.path] : ON_FAILURE[exchange.path]
  if (!action) return

  const ip = addressOf(exchange.headers)
  const email = exchange.user?.email ?? emailOf(exchange.body)
  const principal = exchange.user
    ? {
        ...attempted(exchange.user.email, ip),
        userId: exchange.user.id,
        name: exchange.user.name,
        actor: exchange.user.name,
      }
    : attempted(email, ip)

  await audit(db, principal, {
    action,
    resourceType: 'session',
    resourceId: exchange.user?.id ?? null,
    resourceName: email,
  })
}
