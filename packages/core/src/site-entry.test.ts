import { describe, expect, it } from 'vitest'
import {
  issueEntryState,
  issueSiteEntry,
  readEntryState,
  readSiteEntry,
  SITE_ENTRY_SECONDS,
  safeLocalPath,
} from './site-entry.ts'

const secret = 'ab'.repeat(32)
const input = {
  host: 'demo.example.com',
  scope: 'host:demo.example.com',
  epoch: 3,
  user: 'ada@example.test',
  state: 'n'.repeat(24),
}

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

describe('safe local path', () => {
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/ /evil.example',
    '/%09/evil.example',
    '/%2F/evil',
    '/%5cevil',
    '/\\evil',
    '/ok\r\nLocation: evil',
    '/\u0000',
    '',
  ])('turns %j into /', (value) => {
    expect(safeLocalPath(value)).toBe('/')
  })

  it('keeps a local path and its query', () => {
    expect(safeLocalPath('/orders/42?tab=items&x=a%20b')).toBe('/orders/42?tab=items&x=a%20b')
    expect(safeLocalPath(undefined)).toBe('/')
  })
})

describe('entry state', () => {
  it('carries the scheme the login service saw, for the host it was made for', () => {
    const state = issueEntryState('demo.example.com', 'https', secret)
    expect(readEntryState(state, 'demo.example.com', secret)).toBe('https')
    expect(readEntryState(issueEntryState('demo.example.com', 'http', secret), 'demo.example.com', secret)).toBe('http')
  })

  it('is no use for another host, with another secret, or with the scheme edited', () => {
    const state = issueEntryState('demo.example.com', 'https', secret)
    expect(readEntryState(state, 'other.example.com', secret)).toBeNull()
    expect(readEntryState(state, 'demo.example.com', 'cd'.repeat(32))).toBeNull()
    expect(readEntryState(state.replace('.https.', '.http.'), 'demo.example.com', secret)).toBeNull()
    expect(readEntryState('s'.repeat(24), 'demo.example.com', secret)).toBeNull()
  })
})
