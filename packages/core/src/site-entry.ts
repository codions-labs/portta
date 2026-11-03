// The token that carries a panel session to a protected site.
//
// A protected site and the panel sit on different hostnames, so the cookie that proves somebody is
// signed in to the panel never reaches the site. The site sends the browser to the panel, the panel
// checks the session and the person's right to see the project behind the host, and sends the
// browser back with this token. It is good for one host, for one decision of that host, for a
// minute, and once. See docs/development/adr/0057-a-panel-session-opens-a-protected-site.md.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SITE_ENTRY_SECONDS = 60

export interface SiteEntryToken {
  host: string
  scope: string
  /** The epoch of the host's decision when the token was made: a rotated password ends it. */
  epoch: number
  user: string
  expiresAt: number
  id: string
}

function sign(payload: string, secret: string): Buffer {
  // A prefix of its own, so no other signed value of the same secret can be mistaken for this one.
  return createHmac('sha256', secret).update(`site-entry.${payload}`).digest()
}

export function issueSiteEntry(
  input: Omit<SiteEntryToken, 'expiresAt' | 'id'>,
  secret: string,
  nowSeconds: number,
): string {
  const token: SiteEntryToken = {
    ...input,
    expiresAt: nowSeconds + SITE_ENTRY_SECONDS,
    id: randomBytes(12).toString('base64url'),
  }
  const encoded = Buffer.from(JSON.stringify(token), 'utf8').toString('base64url')
  return `${encoded}.${sign(encoded, secret).toString('base64url')}`
}

export function readSiteEntry(value: string, secret: string, nowSeconds: number): SiteEntryToken | null {
  try {
    const [encoded, supplied, extra] = value.split('.')
    if (!encoded || !supplied || extra !== undefined) return null
    const actual = sign(encoded, secret)
    const candidate = Buffer.from(supplied, 'base64url')
    if (candidate.length !== actual.length || !timingSafeEqual(candidate, actual)) return null
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      typeof parsed.host !== 'string' ||
      typeof parsed.scope !== 'string' ||
      typeof parsed.user !== 'string' ||
      typeof parsed.id !== 'string' ||
      !Number.isSafeInteger(parsed.epoch) ||
      !Number.isSafeInteger(parsed.expiresAt)
    )
      return null
    if ((parsed.expiresAt as number) <= nowSeconds) return null
    return parsed as unknown as SiteEntryToken
  } catch {
    return null
  }
}
