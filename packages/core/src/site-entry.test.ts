import { describe, expect, it } from 'vitest'
import { issueSiteEntry, readSiteEntry, SITE_ENTRY_SECONDS } from './site-entry.ts'

const secret = 'ab'.repeat(32)
const input = { host: 'demo.example.com', scope: 'host:demo.example.com', epoch: 3, user: 'Ada' }

describe('site entry token', () => {
  it('carries who and where, and lasts a minute', () => {
    const token = issueSiteEntry(input, secret, 1000)
    expect(readSiteEntry(token, secret, 1000)).toMatchObject({ ...input, expiresAt: 1000 + SITE_ENTRY_SECONDS })
    expect(readSiteEntry(token, secret, 1000 + SITE_ENTRY_SECONDS)).toBeNull()
  })

  it('refuses a token signed with another secret or edited after signing', () => {
    const token = issueSiteEntry(input, secret, 1000)
    expect(readSiteEntry(token, 'cd'.repeat(32), 1000)).toBeNull()
    const [encoded, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...input, host: 'other.example.com', expiresAt: 9999, id: 'x' }))
    expect(readSiteEntry(`${forged.toString('base64url')}.${signature}`, secret, 1000)).toBeNull()
    expect(readSiteEntry(`${encoded}`, secret, 1000)).toBeNull()
  })

  it('gives every token its own id, so one can be spent once', () => {
    const a = readSiteEntry(issueSiteEntry(input, secret, 1000), secret, 1000)
    const b = readSiteEntry(issueSiteEntry(input, secret, 1000), secret, 1000)
    expect(a?.id).not.toBe(b?.id)
  })
})
