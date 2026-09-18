import { describe, expect, it } from 'vitest'
import { issueSession, readSession } from './session.ts'

const secret = 'ab'.repeat(32)
const payload = {
  scope: 'share:a7f3',
  host: 'demo.example.com',
  user: 'reviewer',
  issuedAt: 10,
  expiresAt: 20,
  epoch: 2,
}

describe('sessions', () => {
  it('round trips a signed payload', () => {
    expect(readSession(issueSession(payload, secret), secret)).toEqual(payload)
  })

  it('refuses changes, another secret and malformed payloads', () => {
    const value = issueSession(payload, secret)
    expect(readSession(`${value}x`, secret)).toBeNull()
    expect(readSession(value, 'cd'.repeat(32))).toBeNull()
    expect(readSession('not.a.session', secret)).toBeNull()
  })
})
