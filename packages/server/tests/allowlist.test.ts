import { describe, expect, it } from 'vitest'
import { assertAllowed, assertValidId, isAllowed, isValidId } from '../src/services/docker/allowlist.ts'

describe('the Docker allowlist', () => {
  it('permits exactly the endpoints the panel needs', () => {
    expect(isAllowed('GET', '/containers/json')).toBe(true)
    expect(isAllowed('GET', '/containers/abc123/json')).toBe(true)
    expect(isAllowed('GET', '/containers/abc123/logs')).toBe(true)
    expect(isAllowed('GET', '/networks')).toBe(true)
    expect(isAllowed('GET', '/events')).toBe(true)
    expect(isAllowed('POST', '/containers/abc123/restart')).toBe(true)
    expect(isAllowed('POST', '/containers/abc123/exec')).toBe(true)
    expect(isAllowed('POST', '/exec/exec123/start')).toBe(true)
    expect(isAllowed('POST', '/exec/exec123/resize')).toBe(true)
    expect(isAllowed('GET', '/exec/exec123/json')).toBe(true)
    expect(isAllowed('DELETE', '/containers/abc123')).toBe(true)
  })

  it('refuses everything else, including endpoints the proxy would forward', () => {
    for (const [method, path] of [
      ['POST', '/containers/prune'],
      ['GET', '/containers/abc/archive'],
      ['POST', '/containers/abc/attach'],
      ['GET', '/images/json'],
      ['DELETE', '/images/nginx'],
      ['GET', '/volumes'],
      ['DELETE', '/volumes/data'],
      ['POST', '/networks/create'],
      ['POST', '/networks/abc/connect'],
      ['DELETE', '/networks/abc'],
      ['POST', '/build'],
      ['DELETE', '/exec/abc/start'],
      ['GET', '/exec/abc/start'],
      ['POST', '/exec/abc/json'],
      ['POST', '/exec/abc/kill'],
      ['GET', '/exec/abc/resize'],
      ['GET', '/secrets'],
      ['POST', '/containers/abc/pause'],
    ] as const) {
      expect(isAllowed(method, path), `${method} ${path}`).toBe(false)
    }
  })

  it('never lets a method cross to another verb', () => {
    expect(isAllowed('GET', '/containers/abc/restart')).toBe(false)
    expect(isAllowed('DELETE', '/containers/json')).toBe(true) // /containers/json is a valid id shape
    expect(isAllowed('POST', '/containers/abc123')).toBe(false)
  })

  it('rejects traversal and encoding tricks before matching', () => {
    expect(isAllowed('GET', '/containers/../images/json')).toBe(false)
    expect(isAllowed('GET', '/containers//json')).toBe(false)
    expect(isAllowed('GET', '/containers/%2e%2e/json')).toBe(false)
  })

  it('throws with the offending call in the message', () => {
    expect(() => assertAllowed('POST', '/containers/prune')).toThrowError(/POST \/containers\/prune/)
  })

  it('validates ids the way Docker spells them', () => {
    expect(isValidId('abc123')).toBe(true)
    expect(isValidId('portta-traefik-1')).toBe(true)
    expect(isValidId('../etc')).toBe(false)
    expect(isValidId('')).toBe(false)
    expect(isValidId('a'.repeat(200))).toBe(false)
    expect(() => assertValidId('a b')).toThrowError(/invalid container/)
  })
})
