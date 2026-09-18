import { describe, expect, it } from 'vitest'
import { resolveServerPort } from './server-port.ts'

describe('resolveServerPort', () => {
  it('prefers the explicit port', () => {
    expect(resolveServerPort(6000, { PORTTA_HOST_PORT: '7000' })).toBe(6000)
  })

  it('falls back to PORTTA_HOST_PORT', () => {
    expect(resolveServerPort(undefined, { PORTTA_HOST_PORT: '7000' })).toBe(7000)
  })

  it('ignores PORT and defaults to 5111', () => {
    expect(resolveServerPort(undefined, { PORT: '8000' })).toBe(5111)
    expect(resolveServerPort(undefined, { PORTTA_HOST_PORT: 'nope' })).toBe(5111)
  })
})
