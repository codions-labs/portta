import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = '__portta_session'

export interface SessionPayload {
  scope: string
  host: string
  user: string
  issuedAt: number
  expiresAt: number
  epoch: number
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

export function issueSession(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`
}

export function readSession(value: string, secret: string): SessionPayload | null {
  try {
    const [encoded, supplied, extra] = value.split('.')
    if (!encoded || !supplied || extra !== undefined) return null
    const actual = signature(encoded, secret)
    const candidate = Buffer.from(supplied, 'base64url')
    if (candidate.length !== actual.length || !timingSafeEqual(candidate, actual)) return null
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
    if (
      typeof parsed.scope !== 'string' ||
      typeof parsed.host !== 'string' ||
      typeof parsed.user !== 'string' ||
      !Number.isSafeInteger(parsed.issuedAt) ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      !Number.isSafeInteger(parsed.epoch)
    )
      return null
    return parsed as unknown as SessionPayload
  } catch {
    return null
  }
}
