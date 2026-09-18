import { describe, expect, it } from 'vitest'
import { capabilitiesFrom, type DetectedFacts, emptyFacts } from './capabilities.js'
import { domainReachesBind, endpointsFor, primaryEndpoint, type ServiceRef } from './endpoints.js'

const WEB: ServiceRef = {
  project: 'storefront',
  service: 'web',
  container: 'storefront-web-1',
  port: 3000,
  kind: 'http',
}
const DB: ServiceRef = {
  project: 'storefront',
  service: 'postgres',
  container: 'storefront-postgres-1',
  port: 5432,
  kind: 'tcp',
}

/** A workstation: loopback only, no address of its own worth the name. */
function laptop(): DetectedFacts {
  return { ...emptyFacts(), resolvedDomain: 'localhost', bindAddress: '127.0.0.1' }
}

/** The Netcup host as it really is: public address, tailnet, Traefik on loopback. */
function vpsOnTailnet(overrides: Partial<DetectedFacts> = {}): DetectedFacts {
  return {
    ...emptyFacts(),
    publicIpv4: '152.53.36.62',
    tailscale: {
      installed: true,
      connected: true,
      ipv4: '100.87.243.7',
      magicDns: 'node.tail1c6f94.ts.net',
      httpsCerts: false,
      funnel: false,
      tagged: false,
    },
    resolvedDomain: '100-87-243-7.sslip.io',
    bindAddress: '127.0.0.1',
    ...overrides,
  }
}

function endpoints(
  service: ServiceRef,
  facts: DetectedFacts,
  exposures: Parameters<typeof endpointsFor>[1]['exposures'],
) {
  return endpointsFor(service, { facts, capabilities: capabilitiesFrom(facts), exposures })
}

describe('the internal endpoint', () => {
  it('is always there, because it is always true', () => {
    const list = endpoints(WEB, laptop(), [])
    expect(list[0]).toMatchObject({
      provider: 'internal',
      url: 'storefront-web-1:3000',
      scope: 'internal',
      usable: true,
    })
  })

  it('is the only endpoint an unroutable datastore gets, whatever is turned on', () => {
    const list = endpoints(DB, vpsOnTailnet(), ['auto-domain', 'tailscale', 'public-ip'])
    expect(list).toHaveLength(1)
    expect(list[0]?.provider).toBe('internal')
  })

  it('is never shareable', () => {
    expect(endpoints(WEB, laptop(), [])[0]?.shareable).toBe(false)
  })
})

describe('a capability is not an exposure', () => {
  // The whole point of the model: the host can do a thing, and does not.
  it('publishes nothing just because the host could', () => {
    const facts = vpsOnTailnet()
    const list = endpoints(WEB, facts, [])
    expect(list.map((entry) => entry.provider)).toEqual(['internal', 'local'])
  })
})

describe('a name that resolves is not a route', () => {
  // This is the bug the whole feature exists to stop reporting as success.
  it('marks a public name unusable while Traefik listens on loopback', () => {
    const list = endpoints(WEB, vpsOnTailnet({ publicIpv4: '152.53.36.62' }), ['auto-domain'])
    const auto = list.find((entry) => entry.provider === 'auto-domain')
    expect(auto?.url).toBe('http://storefront-web.152-53-36-62.sslip.io')
    expect(auto?.usable).toBe(false)
    expect(auto?.shareable).toBe(false)
    expect(auto?.problem).toMatch(/Traefik listens on 127\.0\.0\.1 only/)
  })

  it('becomes usable once Traefik listens where the name points', () => {
    const list = endpoints(WEB, vpsOnTailnet({ bindAddress: '0.0.0.0' }), ['auto-domain'])
    expect(list.find((entry) => entry.provider === 'auto-domain')).toMatchObject({ usable: true, shareable: true })
  })

  it('says the tailnet name needs the tailnet address bound, not public exposure', () => {
    const tailscale = endpoints(WEB, vpsOnTailnet(), ['tailscale']).find((entry) => entry.provider === 'tailscale')
    expect(tailscale?.url).toBe('http://storefront-web.100-87-243-7.sslip.io')
    expect(tailscale?.problem).toMatch(/Set the bind address to 100\.87\.243\.7/)
  })

  it('reports the gateway base itself as broken when it points nowhere Traefik listens', () => {
    // Exactly the Netcup state: domain mode auto on the tailnet address, and
    // Traefik still on loopback. The base does not work even from the host.
    const local = endpoints(WEB, vpsOnTailnet(), []).find((entry) => entry.provider === 'local')
    expect(local?.usable).toBe(false)
    expect(local?.problem).toMatch(/does not resolve to an address Traefik listens on/)
  })

  it('a localhost base on a loopback bind is the one that does work', () => {
    const local = endpoints(WEB, laptop(), []).find((entry) => entry.provider === 'local')
    expect(local).toMatchObject({ url: 'http://storefront-web.localhost', usable: true })
  })
})

describe('domainReachesBind', () => {
  it('loopback serves only the names that resolve to it', () => {
    const facts = { ...emptyFacts(), bindAddress: '127.0.0.1' }
    expect(domainReachesBind('localhost', facts)).toBe(true)
    expect(domainReachesBind('dev.localhost', facts)).toBe(true)
    expect(domainReachesBind('1-2-3-4.sslip.io', facts)).toBe(false)
  })

  it('every interface serves every name', () => {
    const facts = { ...emptyFacts(), bindAddress: '0.0.0.0' }
    expect(domainReachesBind('1-2-3-4.sslip.io', facts)).toBe(true)
    expect(domainReachesBind('dev.example.com', facts)).toBe(true)
  })

  it('a specific bind serves only the name encoding that address', () => {
    const facts = { ...emptyFacts(), bindAddress: '100.87.243.7' }
    expect(domainReachesBind('100-87-243-7.sslip.io', facts)).toBe(true)
    expect(domainReachesBind('152-53-36-62.sslip.io', facts)).toBe(false)
  })
})

describe('the tunnel does not depend on the bind address', () => {
  function withTunnel(connected: boolean, access = false): DetectedFacts {
    return {
      ...vpsOnTailnet(),
      cloudflare: {
        connectorAvailable: true,
        tunnelConfigured: true,
        tunnelConnected: connected,
        accessConfigured: access,
        zone: 'portta.app',
      },
    }
  }

  it('works while Traefik stays on loopback, because cloudflared dials it from inside', () => {
    const list = endpoints(WEB, withTunnel(true), ['cloudflare-tunnel'])
    const tunnel = list.find((entry) => entry.provider === 'cloudflare-tunnel')
    expect(tunnel).toMatchObject({
      url: 'https://storefront-web.portta.app',
      scope: 'public',
      usable: true,
      shareable: true,
    })
  })

  it('is protected rather than public once an Access application covers it', () => {
    const tunnel = endpoints(WEB, withTunnel(true, true), ['cloudflare-tunnel']).find(
      (entry) => entry.provider === 'cloudflare-tunnel',
    )
    expect(tunnel?.scope).toBe('protected')
  })

  it('says so when the connector is not connected', () => {
    const tunnel = endpoints(WEB, withTunnel(false), ['cloudflare-tunnel']).find(
      (entry) => entry.provider === 'cloudflare-tunnel',
    )
    expect(tunnel).toMatchObject({
      usable: false,
      problem: expect.stringMatching(/no connection to the Cloudflare edge/),
    })
  })
})

describe('several endpoints at once', () => {
  it('keeps a private and a public endpoint side by side', () => {
    const facts: DetectedFacts = {
      ...vpsOnTailnet({ bindAddress: '0.0.0.0' }),
      cloudflare: {
        connectorAvailable: true,
        tunnelConfigured: true,
        tunnelConnected: true,
        accessConfigured: false,
        zone: 'portta.app',
      },
    }
    const list = endpoints(WEB, facts, ['tailscale', 'cloudflare-tunnel'])
    expect(list.map((entry) => entry.provider)).toEqual(['internal', 'local', 'tailscale', 'cloudflare-tunnel'])
  })

  it('shows the most reachable URL that actually works, never one that merely exists', () => {
    // Public name configured, Traefik on loopback: the tailnet URL is the one
    // worth showing, and neither of them is the public one.
    const facts = vpsOnTailnet({ bindAddress: '100.87.243.7' })
    const list = endpoints(WEB, facts, ['tailscale', 'auto-domain'])
    expect(primaryEndpoint(list)?.provider).toBe('tailscale')
  })

  it('falls back to the internal endpoint when nothing else works', () => {
    const list = endpoints(WEB, vpsOnTailnet(), ['auto-domain'])
    expect(primaryEndpoint(list)?.scope).toBe('internal')
  })
})

describe('a hostname-routable datastore', () => {
  const POSTGRES: ServiceRef = {
    project: 'storefront',
    service: 'postgres',
    container: 'storefront-postgres-1',
    port: 5432,
    kind: 'postgres',
  }

  function tcp(
    facts: DetectedFacts,
    exposures: Parameters<typeof endpointsFor>[1]['exposures'],
    extra: Partial<Parameters<typeof endpointsFor>[1]> = {},
  ) {
    return endpointsFor(POSTGRES, {
      facts,
      capabilities: capabilitiesFrom(facts),
      exposures,
      tcpRouted: true,
      tcpPort: 5432,
      ...extra,
    })
  }

  it('emits one host:port per provider that can carry it', () => {
    const facts = vpsOnTailnet({
      bindAddress: '0.0.0.0',
      privateIpv4: ['192.168.1.10'],
      customDomain: 'dev.example.com',
    })
    const list = tcp(facts, ['lan', 'tailscale', 'custom-domain'])
    expect(list.map((entry) => entry.provider)).toEqual(['internal', 'local', 'lan', 'tailscale', 'custom-domain'])
    expect(list.find((entry) => entry.provider === 'custom-domain')?.url).toBe(
      'storefront-postgres.dev.example.com:5432',
    )
    expect(list.find((entry) => entry.provider === 'lan')?.url).toBe('storefront-postgres.192-168-1-10.sslip.io:5432')
  })

  it('emits nothing routed when the container has not opted in', () => {
    const list = endpointsFor(POSTGRES, {
      facts: vpsOnTailnet({ bindAddress: '0.0.0.0' }),
      capabilities: capabilitiesFrom(vpsOnTailnet()),
      exposures: ['auto-domain', 'tailscale'],
      tcpRouted: false,
      tcpPort: 5432,
    })
    expect(list.map((entry) => entry.provider)).toEqual(['internal'])
  })

  it('keeps a live loopback bridge as a local endpoint beside the routed ones', () => {
    const list = tcp(vpsOnTailnet({ bindAddress: '0.0.0.0' }), [], {
      bridge: { host: '127.0.0.1', port: 55431 },
    })
    const bridge = list.find((entry) => entry.provider === 'bridge')
    expect(bridge).toMatchObject({ url: '127.0.0.1:55431', scope: 'local', usable: true, shareable: false })
  })

  it('still gives MySQL exactly one internal endpoint', () => {
    const mysql: ServiceRef = {
      ...POSTGRES,
      service: 'mysql',
      container: 'storefront-mysql-1',
      port: 3306,
      kind: 'mysql',
    }
    const list = endpointsFor(mysql, {
      facts: vpsOnTailnet({ bindAddress: '0.0.0.0' }),
      capabilities: capabilitiesFrom(vpsOnTailnet()),
      exposures: ['auto-domain', 'tailscale', 'custom-domain'],
      tcpRouted: true,
      tcpPort: 3306,
    })
    expect(list).toHaveLength(1)
    expect(list[0]?.provider).toBe('internal')
  })
})
