import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PanelConfig } from '../src/config.ts'
import { credentialConfigured, TunnelSetupError, writeTunnelSetup } from '../src/services/tunnel.ts'
import { makeApp, post, testConfig } from './helpers.ts'

/**
 * A well-formed token with no account behind it.
 *
 * Real in shape and worthless in fact, which is exactly what a test should
 * carry: every code path that handles a credential runs, and nothing here is
 * usable by anybody who reads it.
 */
const TUNNEL_ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef'
const TOKEN = Buffer.from(
  JSON.stringify({ a: '0'.repeat(32), t: TUNNEL_ID, s: Buffer.from('x'.repeat(32)).toString('base64') }),
).toString('base64')

let dir: string
let config: PanelConfig

function makeConfig(overrides: Partial<PanelConfig> = {}): PanelConfig {
  const envFile = join(dir, '.env')
  writeFileSync(envFile, 'PORTTA_PROFILE=local\n')
  return { ...testConfig(), envFile, tunnelDir: join(dir, 'cloudflared'), ...overrides } as PanelConfig
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portta-tunnel-'))
  config = makeConfig()
})

describe('setting the connector up from a token', () => {
  // A credential every user on the host can read is not a credential.
  it('keeps the credential to its owner', () => {
    writeTunnelSetup(config, { zone: 'portta.app', token: TOKEN })
    expect(statSync(join(config.tunnelDir, 'credentials.json')).mode & 0o777).toBe(0o600)
    expect(statSync(config.tunnelDir).mode & 0o777).toBe(0o700)
  })

  it('explains a token that is not one, without quoting it', () => {
    expect(() => writeTunnelSetup(config, { zone: 'portta.app', token: 'not a token' })).toThrow(TunnelSetupError)
    // Nothing is left behind by a refused setup.
    expect(credentialConfigured(config)).toBe(false)
  })

  it('refuses a zone that could never become a wildcard, before writing anything', () => {
    expect(() => writeTunnelSetup(config, { zone: 'not a domain', token: TOKEN })).toThrow()
    expect(credentialConfigured(config)).toBe(false)
  })
})

describe('the API', () => {
  // makeApp builds its own config; the routes hold it by reference, so pointing
  // it at this test's temporary directory is enough to isolate every write.
  function api(overrides: Partial<PanelConfig> = {}) {
    const built = makeApp({}, overrides)
    Object.assign(built.config, { envFile: config.envFile, tunnelDir: config.tunnelDir })
    return built
  }

  it('never returns the token in the setup response', async () => {
    const { app } = api()
    const response = await post(app, '/api/tunnel/setup', { zone: 'portta.app', token: TOKEN })
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain(TOKEN)
  })

  it('never writes the token into .env', async () => {
    const { app } = api()
    await post(app, '/api/tunnel/setup', { zone: 'portta.app', token: TOKEN })
    const env = readFileSync(config.envFile, 'utf8')
    expect(env).not.toContain(TOKEN)
    // The zone and the id are configuration, and belong there.
    expect(env).toContain('CLOUDFLARE_TUNNEL_ZONE=portta.app')
    expect(env).toContain(`CLOUDFLARE_TUNNEL_ID=${TUNNEL_ID}`)
  })

  it('explains a bad token with 400 rather than failing opaquely', async () => {
    const { app } = api()
    const response = await post(app, '/api/tunnel/setup', { zone: 'portta.app', token: 'nope' })
    expect(response.status).toBe(400)
  })

  it('refuses to enable before there is anything to enable', async () => {
    const { app } = api()
    expect((await post(app, '/api/tunnel/enable', {})).status).toBe(400)
  })

  it('enables only after setup, and says so in .env', async () => {
    const { app } = api()
    await post(app, '/api/tunnel/setup', { zone: 'portta.app', token: TOKEN })
    expect((await post(app, '/api/tunnel/enable', {})).status).toBe(200)
    expect(readFileSync(config.envFile, 'utf8')).toContain('CLOUDFLARE_TUNNEL_ENABLED=true')
  })

  it('disabling keeps the configuration, so re-enabling needs no token', async () => {
    const { app } = api()
    await post(app, '/api/tunnel/setup', { zone: 'portta.app', token: TOKEN })
    await post(app, '/api/tunnel/enable', {})
    await post(app, '/api/tunnel/disable', {})
    expect(readFileSync(config.envFile, 'utf8')).toContain('CLOUDFLARE_TUNNEL_ENABLED=false')
    expect(credentialConfigured(config)).toBe(true)
  })

  it('forgetting removes the credential', async () => {
    const { app } = api()
    await post(app, '/api/tunnel/setup', { zone: 'portta.app', token: TOKEN })
    await post(app, '/api/tunnel/disable', { forget: true })
    expect(readFileSync(join(config.tunnelDir, 'credentials.json'), 'utf8')).toBe('')
  })
})
