// The token that carries a panel session to a protected site.
//
// A protected site and the panel sit on different hostnames, so the cookie that proves somebody is
// signed in to the panel never reaches the site. The site sends the browser to the panel, the panel
// checks the session and the person's right to see the project behind the host, and sends the
// browser back with this token. It is good for one host, for one decision of that host, for a
// minute, and once. See docs/development/adr/0057-a-panel-session-opens-a-protected-site.md.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SITE_ENTRY_SECONDS = 60

/**
 * A path on the same host, or `/`.
 *
 * Browsers drop tabs and line breaks from an address before they read it, so `/<tab>/evil.example`
 * is `//evil.example` to them. Every control character is therefore refused, and so is a
 * backslash, which they read as a slash. One implementation, for the panel and the login service.
 */
export function safeLocalPath(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/'
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\\\s]/.test(value) || /%(?:0[0-9a-d]|1[0-9a-f]|7f|2f|5c)/i.test(value)) return '/'
  return value
}

/** The shape of the value that ties a token to the browser that asked for it. */
export const SITE_ENTRY_STATE = /^[A-Za-z0-9_-]{16,64}\.(http|https)\.[A-Za-z0-9_-]{20,64}$/

function stateMac(nonce: string, host: string, proto: string, secret: string): string {
  return createHmac('sha256', secret).update(`site-entry-state.${host}.${proto}.${nonce}`).digest('base64url')
}

/**
 * What the login service gives a browser before sending it to the panel.
 *
 * The scheme it saw is part of it and so is the host, signed, so the panel can trust the scheme to
 * return to without taking it from a link, and a value made for one host is no use for another.
 */
export function issueEntryState(host: string, proto: 'http' | 'https', secret: string): string {
  const nonce = randomBytes(18).toString('base64url')
  return `${nonce}.${proto}.${stateMac(nonce, host, proto, secret)}`
}

/** The scheme the login service saw, or null when the value is not one it made for this host. */
export function readEntryState(value: string, host: string, secret: string): 'http' | 'https' | null {
  if (!SITE_ENTRY_STATE.test(value)) return null
  const [nonce, proto, mac] = value.split('.') as [string, 'http' | 'https', string]
  const expected = Buffer.from(stateMac(nonce, host, proto, secret))
  const supplied = Buffer.from(mac)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? proto : null
}

export interface SiteEntryToken {
  host: string
  scope: string
  /** The epoch of the host's decision when the token was made: a rotated password ends it. */
  epoch: number
  user: string
  /** What the browser that asked for the token holds, so a token cannot be put in another browser. */
  state: string
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
      typeof parsed.state !== 'string' ||
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
