// The daemon's one credential check.
//
// The token is a shared secret between this process and whoever can read
// `state/host/token`: the operator's CLI and the panel, which mounts it
// read-only. There are no users here and no permissions; the panel decides
// those before a request is forwarded (ADR 0047).

import { createHash, timingSafeEqual } from 'node:crypto'

/** The token in `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  return match?.[1] ?? null
}

/**
 * Whether a presented token is the expected one, in constant time.
 *
 * Both sides are hashed first so the comparison never depends on a length the
 * caller chose: `timingSafeEqual` refuses buffers of different sizes, and
 * returning early on that would say how long the secret is.
 */
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (presented === null || expected === '') return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(presented), digest(expected))
}
