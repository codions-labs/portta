// The one decision made from the environment, and the two it refuses to make.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConfigError, resolveSecurityMode, trustedOrigins, useSecureCookies } from '../src/security-mode.ts'

const env = (values: Record<string, string> = {}): NodeJS.ProcessEnv => values

describe('the security mode', () => {
  it('is open by default, which is only safe on loopback', () => {
    const security = resolveSecurityMode(env())
    expect(security.mode).toBe('open')
    expect(security.bindAddress).toBe('127.0.0.1')
  })

  // Who can reach the address is the whole question, and the access mode is the
  // answer Portta already has for it. A tailnet node and a VPN client are sets
  // somebody authenticated; `public` and `domain` are not.
  it('accepts open mode behind a network that authenticates on its own', () => {
    expect(
      resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: 'tailscale', PORTTA_WEB_BIND_ADDRESS: '100.64.0.2' })).mode,
    ).toBe('open')
    expect(resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: 'vpn' })).mode).toBe('open')
  })

  it('refuses open mode where the panel answers whoever finds the address', () => {
    for (const expose of ['public', 'domain']) {
      expect(() => resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: expose }))).toThrow(ConfigError)
      expect(() => resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: expose }))).toThrow(/answers whoever finds the address/)
    }
  })

  // The one case the access mode does not settle: `local` is loopback by
  // construction, so a LAN address there is an operator's own doing and has to
  // be said out loud.
  it('refuses open mode on the local network unless the operator named it', () => {
    const lan = { PORTTA_WEB_BIND_ADDRESS: '192.168.1.10' }
    expect(() => resolveSecurityMode(env(lan))).toThrow(/local network/)
    expect(resolveSecurityMode(env({ ...lan, PORTTA_AUTH_ALLOW_LAN: 'true' })).mode).toBe('open')
  })

  it('refuses an access mode nothing names', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: 'wherever' }))).toThrow(ConfigError)
  })

  it('refuses protected mode with no secret to sign sessions with', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'required' }))).toThrow(/PORTTA_AUTH_SECRET is required/)
  })

  it('refuses a mode nothing names', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'maybe' }))).toThrow(/must be disabled or required/)
  })

  it('accepts protected mode with a secret', () => {
    const security = resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'x'.repeat(32) }))
    expect(security.mode).toBe('protected')
    expect(security.secret).toHaveLength(32)
    expect(security.development).toBe(false)
  })

  it('is a development panel when the checkout says so', () => {
    expect(resolveSecurityMode(env({ NODE_ENV: 'development' })).development).toBe(true)
    expect(resolveSecurityMode(env({ PORTTA_WEB_DEV: 'true' })).development).toBe(true)
    expect(resolveSecurityMode(env({ NODE_ENV: 'test' })).development).toBe(false)
  })
})

describe('the origins a browser may write from', () => {
  it('names the panel and both loopback spellings on its port, never a wildcard', () => {
    const security = resolveSecurityMode(env({ PORTTA_WEB_PORT: '8081' }))
    expect(trustedOrigins(security)).toEqual(['http://127.0.0.1:8081', 'http://localhost:8081'])
  })

  it('adds the ones the operator configured', () => {
    const security = resolveSecurityMode(
      env({
        PORTTA_AUTH_MODE: 'required',
        PORTTA_AUTH_SECRET: 'x',
        PORTTA_WEB_EXPOSE: 'vpn',
        PORTTA_PANEL_URL: 'https://portta.example.com',
        PORTTA_PANEL_TRUSTED_ORIGINS: 'https://vpn.example.com, https://other.example.com',
      }),
    )
    expect(trustedOrigins(security)).toContain('https://vpn.example.com')
    expect(trustedOrigins(security)).toContain('https://other.example.com')
  })
})

describe('the session cookie', () => {
  // `Secure` on plain HTTP means the browser drops the cookie and nobody can
  // sign in; off under HTTPS means it travels where it should not.
  it('is secure under https and not under plain loopback http', () => {
    const https = resolveSecurityMode(
      env({
        PORTTA_AUTH_MODE: 'required',
        PORTTA_AUTH_SECRET: 'x',
        PORTTA_WEB_EXPOSE: 'vpn',
        PORTTA_PANEL_URL: 'https://portta.example.com',
      }),
    )
    expect(useSecureCookies(https)).toBe(true)
    expect(useSecureCookies(resolveSecurityMode(env()))).toBe(false)
  })
})

describe('read-only mode', () => {
  it('is read from the runtime flag the rest of the panel already uses', () => {
    expect(resolveSecurityMode(env({ PORTTA_RUNTIME_READ_ONLY: 'true' })).readOnly).toBe(true)
    expect(resolveSecurityMode(env()).readOnly).toBe(false)
  })
})

// Compose sets every key in a service's `environment`, whether or not the
// operator gave it a value, so the process sees `''` and not "absent". `??`
// does not catch that: the panel booted with an empty PORTTA_PANEL_URL and
// crashed on `new URL('')` before it could serve anything.
describe('a value Compose set to nothing', () => {
  const emptied = {
    PORTTA_AUTH_MODE: '',
    PORTTA_AUTH_SECRET: '',
    PORTTA_PANEL_URL: '',
    PORTTA_PANEL_TRUSTED_ORIGINS: '',
    PORTTA_WEB_BIND_ADDRESS: '',
    PORTTA_WEB_EXPOSE: '',
    PORTTA_WEB_PORT: '',
  }

  it('is the same as one nobody set', () => {
    const security = resolveSecurityMode(env(emptied))
    expect(security.mode).toBe('open')
    expect(security.secret).toBeNull()
    expect(security.bindAddress).toBe('127.0.0.1')
    expect(security.panelUrl.origin).toBe('http://127.0.0.1:8081')
    expect(security.trustedOrigins).toEqual([])
  })

  it('and an empty secret is still a missing secret in required mode', () => {
    expect(() => resolveSecurityMode(env({ ...emptied, PORTTA_AUTH_MODE: 'required' }))).toThrow(ConfigError)
  })

  it('while a port with no URL beside it still decides the fallback', () => {
    const security = resolveSecurityMode(env({ ...emptied, PORTTA_WEB_PORT: '9000' }))
    expect(security.panelUrl.origin).toBe('http://127.0.0.1:9000')
  })
})

// Per address, and a whole office behind one NAT is one address. Configurable
// for that reason, with a floor so it cannot be turned into no limit at all.
describe('how many sign-in attempts an address gets', () => {
  it('is five unless somebody says otherwise', () => {
    expect(resolveSecurityMode(env()).signInAttempts).toBe(5)
  })

  it('takes a number an operator chose', () => {
    expect(resolveSecurityMode(env({ PORTTA_AUTH_SIGNIN_ATTEMPTS: '25' })).signInAttempts).toBe(25)
  })

  it('and refuses one that would remove the limit', () => {
    for (const value of ['0', '1', '2', '-5', '10000', 'lots', '']) {
      expect(resolveSecurityMode(env({ PORTTA_AUTH_SIGNIN_ATTEMPTS: value })).signInAttempts, value).toBe(5)
    }
  })
})

// The rule runs inside the panel container, so every variable it reads has to
// be passed there. PORTTA_AUTH_ALLOW_LAN once was not, and a LAN panel refused
// to start with `true` set in .env.
describe('the variables the rule reads', () => {
  it('all reach the panel container', () => {
    const root = new URL('../../../', import.meta.url)
    const source = readFileSync(new URL('packages/auth/src/security-mode.ts', root), 'utf8')
    const compose = readFileSync(new URL('docker/compose/features/web.yaml', root), 'utf8')
    const read = [...new Set([...source.matchAll(/env\.(PORTTA_[A-Z_]+)\b/g)].map((match) => match[1]!))]
    expect(read).toContain('PORTTA_AUTH_ALLOW_LAN')
    // PORTTA_WEB_DEV only mirrors NODE_ENV=development, which web-dev.yaml sets.
    const passed = (name: string) => name === 'PORTTA_WEB_DEV' || new RegExp(`^\\s+${name}:`, 'm').test(compose)
    expect(read.filter((name) => !passed(name))).toEqual([])
  })
})
