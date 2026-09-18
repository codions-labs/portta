import { describe, expect, it } from 'vitest'
import { autoDomainFor, exampleHostnames, ipFromAutoDomain, isIpv4, resolveDomain } from './domain.js'

describe('the auto domain', () => {
  it('puts the address in one label, so a wildcard certificate can cover it', () => {
    expect(autoDomainFor('203.0.113.10')).toBe('203-0-113-10.sslip.io')
  })

  it('refuses anything that is not an address, rather than building a hostname from it', () => {
    for (const value of ['', 'localhost', '203.0.113', '203.0.113.999', '1.2.3.4.5', 'a.b.c.d']) {
      expect(autoDomainFor(value), value).toBeNull()
    }
  })

  it('reads the address back out of a name it built', () => {
    expect(ipFromAutoDomain('203-0-113-10.sslip.io')).toBe('203.0.113.10')
    expect(ipFromAutoDomain('web.203-0-113-10.sslip.io')).toBe('203.0.113.10')
    expect(ipFromAutoDomain('dev.example.com')).toBeNull()
  })

  it('accepts every octet boundary and no more', () => {
    expect(isIpv4('0.0.0.0')).toBe(true)
    expect(isIpv4('255.255.255.255')).toBe(true)
    expect(isIpv4('256.0.0.1')).toBe(false)
  })
})

describe('resolving the base domain', () => {
  it('local is localhost, whatever else is configured', () => {
    const result = resolveDomain({ mode: 'local', publicIp: '203.0.113.10', configured: 'dev.example.com' })
    expect(result).toEqual({ mode: 'local', domain: 'localhost', problem: null })
  })

  it('auto builds one from the detected address', () => {
    expect(resolveDomain({ mode: 'auto', publicIp: '203.0.113.10' }).domain).toBe('203-0-113-10.sslip.io')
  })

  it('custom uses the configured domain', () => {
    expect(resolveDomain({ mode: 'custom', configured: 'dev.example.com' }).domain).toBe('dev.example.com')
  })

  // A gateway that refuses to start over an unreachable hostname is worse than
  // the hostname. Every failure falls back and says what went wrong.
  it('auto without an address falls back and says so', () => {
    const result = resolveDomain({ mode: 'auto' })
    expect(result.domain).toBe('localhost')
    expect(result.problem).toMatch(/no public address/)
  })

  it('auto with a value that is not an address falls back and says so', () => {
    const result = resolveDomain({ mode: 'auto', publicIp: 'not-an-ip' })
    expect(result.domain).toBe('localhost')
    expect(result.problem).toMatch(/not an IPv4 address/)
  })

  it('custom without a domain falls back and says so', () => {
    const result = resolveDomain({ mode: 'custom' })
    expect(result.domain).toBe('localhost')
    expect(result.problem).toMatch(/no domain is set/)
  })

  it('an unknown mode is treated as local rather than trusted', () => {
    expect(resolveDomain({ mode: 'whatever' })).toEqual({ mode: 'local', domain: 'localhost', problem: null })
  })
})

describe('the preview the panel shows', () => {
  it('is the hostname a project would actually get', () => {
    expect(exampleHostnames('203-0-113-10.sslip.io')).toEqual([
      'loja-web.203-0-113-10.sslip.io',
      'loja-api.203-0-113-10.sslip.io',
    ])
    expect(exampleHostnames('localhost')).toEqual(['loja-web.localhost', 'loja-api.localhost'])
  })
})
