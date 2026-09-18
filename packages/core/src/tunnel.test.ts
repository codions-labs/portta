import { describe, expect, it } from 'vitest'
import {
  parseTunnelToken,
  renderTunnelConfig,
  renderTunnelCredentials,
  type TunnelConfig,
  tunnelDnsTarget,
  tunnelStatusFrom,
} from './tunnel.js'

const BASE: TunnelConfig = {
  id: '6ff42ae2-765d-4adf-8112-31c55c1551ef',
  zone: 'portta.app',
  origin: 'http://traefik:80',
  credentialsFile: '/etc/cloudflared/credentials.json',
}

describe('the connector configuration', () => {
  it('routes the whole zone with one rule, which is the entire point', () => {
    const yaml = renderTunnelConfig(BASE)
    expect(yaml).toContain('- hostname: "*.portta.app"')
    expect(yaml).toContain('service: "http://traefik:80"')
    // One wildcard and one catch-all: no per-service rule, ever.
    expect(yaml.match(/- hostname:/g)).toHaveLength(1)
  })

  it('ends in the catch-all cloudflared requires', () => {
    expect(renderTunnelConfig(BASE).trimEnd()).toMatch(/- service: http_status:404$/)
  })

  it('never sets httpHostHeader, because Traefik routes on the original', () => {
    // The comment explaining its absence mentions it; the directive itself
    // would rewrite Host at the connector and break every route below.
    expect(renderTunnelConfig(BASE)).not.toMatch(/^\s*httpHostHeader:/m)
  })

  it('puts an explicit route before the wildcard, where it can match', () => {
    const yaml = renderTunnelConfig({
      ...BASE,
      extraRoutes: [{ hostname: 'panel.portta.app', service: 'http://web:3000' }],
    })
    expect(yaml.indexOf('panel.portta.app')).toBeLessThan(yaml.indexOf('*.portta.app'))
  })

  it('leaves the apex alone unless asked, because the wildcard does not cover it', () => {
    // Verified with `cloudflared tunnel ingress rule`: portta.app falls through
    // to the catch-all while web--demo.portta.app matches the wildcard.
    expect(renderTunnelConfig(BASE)).not.toContain('- hostname: "portta.app"')
    expect(renderTunnelConfig({ ...BASE, includeApex: true })).toContain('- hostname: "portta.app"')
  })
})

describe('what it refuses to write', () => {
  it('a tunnel id that is not a UUID', () => {
    expect(() => renderTunnelConfig({ ...BASE, id: 'my-tunnel' })).toThrow(/not a UUID/)
  })

  it('a zone that would become a wildcard matching nothing', () => {
    expect(() => renderTunnelConfig({ ...BASE, zone: 'not a hostname' })).toThrow(/not a hostname/)
  })

  it('a value that would break out of its YAML scalar', () => {
    expect(() => renderTunnelConfig({ ...BASE, origin: 'http://traefik:80"\nevil: true' })).toThrow(
      /quotes or newlines/,
    )
  })

  it('an extra route with a hostname that is not one', () => {
    expect(() => renderTunnelConfig({ ...BASE, extraRoutes: [{ hostname: 'nope', service: 'http://x:1' }] })).toThrow(
      /not a hostname/,
    )
  })
})

describe('the one DNS record the operator creates', () => {
  it('is a CNAME to the tunnel subdomain', () => {
    expect(tunnelDnsTarget(BASE.id)).toBe('6ff42ae2-765d-4adf-8112-31c55c1551ef.cfargotunnel.com')
  })

  it('refuses to build one from a name that is not a tunnel id', () => {
    expect(() => tunnelDnsTarget('portta')).toThrow(/not a UUID/)
  })
})

describe('the token is the only credential we ask for', () => {
  const CREDENTIALS = {
    AccountTag: 'a'.repeat(32),
    TunnelID: '6ff42ae2-765d-4adf-8112-31c55c1551ef',
    TunnelSecret: 'c2VjcmV0',
  }
  const TOKEN = Buffer.from(
    JSON.stringify({ a: CREDENTIALS.AccountTag, t: CREDENTIALS.TunnelID, s: CREDENTIALS.TunnelSecret }),
  ).toString('base64')

  it('decodes into exactly the credentials file cloudflared reads', () => {
    // Verified against cloudflared 2026.7.3: a credentials file built this way
    // loads and reaches "Registering tunnel connection".
    expect(parseTunnelToken(TOKEN)).toEqual(CREDENTIALS)
  })

  it('tolerates the whitespace that comes with a copy and paste', () => {
    expect(parseTunnelToken(`  ${TOKEN}\n`)).toEqual(CREDENTIALS)
  })

  it('rejects an empty value plainly', () => {
    expect(() => parseTunnelToken('   ')).toThrow(/no token was given/)
  })

  it('never puts the value in the error message', () => {
    // An error is displayed, logged and sometimes pasted into an issue.
    try {
      parseTunnelToken(`${TOKEN}!!`)
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN.slice(0, 20))
    }
  })

  it('writes the credentials file cloudflared expects', () => {
    expect(JSON.parse(renderTunnelCredentials(CREDENTIALS))).toEqual(CREDENTIALS)
  })
})

describe('the state the panel reports', () => {
  const READY = {
    tokenConfigured: true,
    zoneConfigured: true,
    enabled: true,
    containerState: 'running',
    containerHealth: 'healthy',
    logTail: '',
  }

  it('asks for a token before anything else', () => {
    expect(tunnelStatusFrom({ ...READY, tokenConfigured: false }).state).toBe('not-configured')
  })

  it('is connected once the connector has registered', () => {
    expect(tunnelStatusFrom({ ...READY, logTail: 'INF Registered tunnel connection connIndex=0' }).state).toBe(
      'connected',
    )
  })

  // A rejected credential is checked before liveness: the container is running
  // perfectly and the tunnel will never come up, so "disconnected" would send
  // somebody to look at the network instead of the token.
  it('names an authentication failure rather than calling it disconnected', () => {
    const status = tunnelStatusFrom({ ...READY, logTail: 'ERR Unauthorized: failed to authenticate' })
    expect(status.state).toBe('auth-error')
    expect(status.hint).toMatch(/Replace the token/)
  })
})
