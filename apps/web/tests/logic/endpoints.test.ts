import { describe, expect, it } from 'vitest'
import { orderEndpoints, primaryEndpoint } from '@/lib/endpoints'

const url = (u: string, scope: 'local' | 'vpn' | 'public', scheme: 'http' | 'https') => ({
  url: u,
  host: u,
  scope,
  scheme,
})

describe('endpoint order', () => {
  it('nearest first, https before http, then alphabetical', () => {
    const ordered = orderEndpoints([
      url('https://a.public', 'public', 'https'),
      url('http://b.local', 'local', 'http'),
      url('https://a.local', 'local', 'https'),
      url('https://c.vpn', 'vpn', 'https'),
    ]).map((entry) => entry.url)
    expect(ordered).toEqual(['https://a.local', 'http://b.local', 'https://c.vpn', 'https://a.public'])
  })
  it('the primary is the first of that order, or nothing', () => {
    expect(
      primaryEndpoint([url('https://a.public', 'public', 'https'), url('http://b.local', 'local', 'http')])?.url,
    ).toBe('http://b.local')
    expect(primaryEndpoint([])).toBeNull()
  })
  it('prefers a domain the user pointed at the gateway over a nearer address', () => {
    const custom = { ...url('https://shop.example.com.br', 'public', 'https'), custom: true }
    expect(primaryEndpoint([url('http://a.local', 'local', 'http'), custom])?.url).toBe('https://shop.example.com.br')
  })
})
