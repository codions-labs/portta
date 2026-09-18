import { describe, expect, it } from 'vitest'
import { capabilitiesFrom, capabilityById, type DetectedFacts, emptyFacts, isUsable } from './capabilities.js'

function facts(overrides: Partial<DetectedFacts> = {}): DetectedFacts {
  return { ...emptyFacts(), ...overrides }
}

function state(input: DetectedFacts, id: Parameters<typeof capabilityById>[1]) {
  return capabilityById(capabilitiesFrom(input), id)
}

describe('what a bare host can do', () => {
  it('always has loopback, and says nothing else is there', () => {
    const list = capabilitiesFrom(emptyFacts())
    expect(capabilityById(list, 'localhost')?.state).toBe('available')
    expect(capabilityById(list, 'lan')?.state).toBe('unavailable')
    expect(capabilityById(list, 'public-ipv4')?.state).toBe('unavailable')
  })

  it('cannot derive an automatic domain without an address to encode', () => {
    expect(state(facts(), 'auto-domain')?.state).toBe('unavailable')
  })
})

describe('the three states Tailscale can be in', () => {
  it('not installed', () => {
    expect(state(facts(), 'tailscale')?.state).toBe('unavailable')
  })

  it('installed but not connected is a decision away, not a dead end', () => {
    const result = state(facts({ tailscale: { ...emptyFacts().tailscale, installed: true } }), 'tailscale')
    expect(result?.state).toBe('configurable')
    // Portta never authenticates somebody's tailnet for them.
    expect(result?.hint).toMatch(/never authenticates it for you/)
  })
})

describe('what tailnet HTTPS gates', () => {
  // Verified on a real tailnet: `tailscale cert` answers "your Tailscale
  // account does not support getting TLS certs" until an admin turns it on,
  // and both Serve-over-HTTPS and Funnel are refused until then.
  const connected = {
    ...emptyFacts().tailscale,
    installed: true,
    connected: true,
    ipv4: '100.87.243.7',
    magicDns: 'node.tail1c6f94.ts.net',
  }

  it('Serve over HTTPS is configurable, not available, until certificates are on', () => {
    const result = state(facts({ tailscale: connected }), 'tailscale-https')
    expect(result?.state).toBe('configurable')
    expect(isUsable(result)).toBe(false)
    // The consequence is stated because it is permanent and public.
    expect(result?.hint).toMatch(/certificate transparency logs/)
  })

  it('Funnel names certificates as the first missing piece, not the policy', () => {
    expect(state(facts({ tailscale: connected }), 'tailscale-funnel')?.problem).toMatch(
      /needs tailnet HTTPS certificates first/,
    )
  })

  it('with certificates on, Funnel still needs the policy attribute', () => {
    const result = state(facts({ tailscale: { ...connected, httpsCerts: true } }), 'tailscale-funnel')
    expect(result?.problem).toMatch(/does not grant this node the funnel attribute/)
    expect(result?.hint).toMatch(/443, 8443 and 10000 only/)
  })

  it('both become available once the tailnet allows them', () => {
    const ready = facts({ tailscale: { ...connected, httpsCerts: true, funnel: true } })
    expect(state(ready, 'tailscale-https')?.state).toBe('available')
    expect(state(ready, 'tailscale-funnel')?.state).toBe('available')
  })
})

describe('the Cloudflare tunnel ladder', () => {
  const base = emptyFacts().cloudflare

  it('no connector at all', () => {
    expect(state(facts(), 'cloudflare-tunnel')?.state).toBe('unavailable')
  })

  it('connector present, nothing configured', () => {
    expect(state(facts({ cloudflare: { ...base, connectorAvailable: true } }), 'cloudflare-tunnel')?.state).toBe(
      'configurable',
    )
  })

  it('configured but disconnected is an error, because it is set up and broken', () => {
    const result = state(
      facts({ cloudflare: { ...base, connectorAvailable: true, tunnelConfigured: true, zone: 'portta.app' } }),
      'cloudflare-tunnel',
    )
    expect(result?.state).toBe('error')
    expect(isUsable(result)).toBe(false)
  })

  it('connected is active, and names the wildcard it serves', () => {
    const result = state(
      facts({
        cloudflare: {
          ...base,
          connectorAvailable: true,
          tunnelConfigured: true,
          tunnelConnected: true,
          zone: 'portta.app',
        },
      }),
      'cloudflare-tunnel',
    )
    expect(result).toMatchObject({ state: 'active', detail: '*.portta.app' })
    expect(isUsable(result)).toBe(true)
  })

  it('Access is only offerable once there is a tunnel to protect', () => {
    expect(state(facts(), 'cloudflare-access')?.state).toBe('unavailable')
    expect(
      state(facts({ cloudflare: { ...base, connectorAvailable: true, tunnelConfigured: true } }), 'cloudflare-access')
        ?.state,
    ).toBe('configurable')
  })

  it('never offers to create an Access application by itself', () => {
    expect(state(facts(), 'cloudflare-access')?.hint).toMatch(/never creates one for you/)
  })
})

describe('HTTPS comes from whatever terminates it', () => {
  it('from Traefik when it holds a certificate', () => {
    expect(state(facts({ tlsEnabled: true }), 'https')).toMatchObject({
      state: 'available',
      detail: 'Traefik terminates TLS',
    })
  })

  it('from the Cloudflare edge through a tunnel, with no certificate here at all', () => {
    const result = state(
      facts({
        cloudflare: {
          ...emptyFacts().cloudflare,
          connectorAvailable: true,
          tunnelConfigured: true,
          tunnelConnected: true,
          zone: 'z',
        },
      }),
      'https',
    )
    expect(result).toMatchObject({ state: 'available', detail: 'terminated at the Cloudflare edge' })
  })

  it('and is honestly unavailable when nothing terminates it', () => {
    expect(state(facts(), 'https')?.state).toBe('unavailable')
  })
})
