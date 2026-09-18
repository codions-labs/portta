import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConfigView } from 'portta-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildConfigView, discardConfig, patchConfig, pendingChangesOf } from '../src/services/configview.ts'
import { ValidationError, validateCombination, validateValue } from '../src/services/settings.ts'
import { makeApp, testConfig } from './helpers.ts'

describe('validation', () => {
  it('checks each value against its own rules', () => {
    expect(() => validateValue('PORTTA_HTTP_PORT', '70000')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_DOMAIN', 'not a domain')).toThrow(ValidationError)
    expect(() => validateValue('TLS_MODE', 'sometimes')).toThrow(ValidationError)
    expect(() => validateValue('TLS_ENABLED', 'maybe')).toThrow(ValidationError)
    expect(() => validateValue('ACME_EMAIL', 'nope')).toThrow(ValidationError)
    expect(() => validateValue('SOMETHING_ELSE', 'x')).toThrowError(/not a setting the panel manages/)
  })

  it('accepts the values the gateway actually uses', () => {
    expect(() => validateValue('PORTTA_DOMAIN', 'vpn.example.com')).not.toThrow()
    expect(() => validateValue('PORTTA_BIND_ADDRESS', '100.64.0.1')).not.toThrow()
    expect(() => validateValue('PUBLIC_DOMAIN', '')).not.toThrow()
    expect(() => validateValue('PORTTA_PROFILE', 'remote-private')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/srv/projects')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/srv/projects/../..')).toThrow(ValidationError)
  })

  // The panel reads this path; `portta doctor` translates it back to the host.
  it('refuses combinations the CLI would refuse at startup', () => {
    expect(() => validateCombination(new Map([['PORTTA_PROFILE', 'remote-public']]))).toThrowError(/PUBLIC_DOMAIN/)

    expect(() =>
      validateCombination(
        new Map([
          ['PORTTA_PROFILE', 'remote-public'],
          ['PORTTA_DOMAIN_MODE', 'custom'],
          ['PORTTA_DOMAIN', 'dev.example.com'],
        ]),
      ),
    ).not.toThrow()

    expect(() =>
      validateCombination(
        new Map([
          ['PORTTA_PROFILE', 'remote-private'],
          ['PORTTA_BIND_ADDRESS', '0.0.0.0'],
        ]),
      ),
    ).toThrowError(/must not bind 0.0.0.0/)

    expect(() =>
      validateCombination(
        new Map([
          ['TLS_ENABLED', 'true'],
          ['TLS_MODE', 'acme'],
        ]),
      ),
    ).toThrowError(/ACME_EMAIL/)
  })

  it('refuses to publish the panel on every interface', () => {
    expect(() => validateCombination(new Map([['PORTTA_WEB_BIND_ADDRESS', '0.0.0.0']]))).toThrowError(
      /not published on every interface/,
    )
  })
})

describe('the Settings view and its writes', () => {
  let dir: string
  let envFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portta-web-'))
    envFile = join(dir, '.env')
    writeFileSync(
      envFile,
      '# gateway\nPORTTA_DOMAIN=localhost\nTLS_ENABLED=false\nTS_AUTHKEY=tskey_auth_secret_value\n',
    )
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts the panel hostname keys the address form writes', () => {
    expect(() => validateValue('PORTTA_WEB_HOST', 'portta')).not.toThrow()
    expect(() => validateValue('PORTTA_WEB_HOST', 'portta.example.com')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_PANEL_ADVERTISED_HOST', 'portta.example.com')).not.toThrow()
  })

  it('flags a saved value that the running gateway has not picked up', () => {
    process.env.PORTTA_DOMAIN = 'localhost'
    const before = buildConfigView(testConfig({ envFile }))
    expect(before.fields.find((f) => f.key === 'PORTTA_DOMAIN')?.pending).toBe(false)

    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    const after = buildConfigView(testConfig({ envFile }))
    expect(after.fields.find((f) => f.key === 'PORTTA_DOMAIN')?.pending).toBe(true)
    expect(after.pendingRestart).toBe(true)
    expect(after.applyCommand).toBe('./bin/portta up local')
    expect(pendingChangesOf(after.fields)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'PORTTA_DOMAIN',
          from: 'localhost',
          to: 'dev.test',
          secret: false,
          fromSet: true,
          toSet: true,
          restartRequired: true,
        }),
      ]),
    )
    delete process.env.PORTTA_DOMAIN
  })

  it('puts the running value back when a pending change is discarded', () => {
    process.env.PORTTA_DOMAIN = 'localhost'
    process.env.PORTTA_LOG_LEVEL = 'INFO'
    try {
      patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test', PORTTA_LOG_LEVEL: 'DEBUG' })
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=dev.test')

      const one = discardConfig(testConfig({ envFile }), ['PORTTA_DOMAIN'])
      expect(one.discarded).toEqual(['PORTTA_DOMAIN'])
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=localhost')
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_LOG_LEVEL=DEBUG')

      const rest = discardConfig(testConfig({ envFile }))
      expect(rest.discarded).toContain('PORTTA_LOG_LEVEL')
      expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_LOG_LEVEL=INFO')
      expect(rest.view.fields.find((field) => field.key === 'PORTTA_LOG_LEVEL')?.pending).toBe(false)
    } finally {
      delete process.env.PORTTA_DOMAIN
      delete process.env.PORTTA_LOG_LEVEL
    }
  })

  it('restores a secret from the running process without returning it', () => {
    process.env.TS_AUTHKEY = 'tskey_auth_secret_value'
    try {
      patchConfig(testConfig({ envFile }), { TS_AUTHKEY: 'tskey_auth_new_value' })
      expect(readFileSync(envFile, 'utf8')).toContain('tskey_auth_new_value')

      const result = discardConfig(testConfig({ envFile }), ['TS_AUTHKEY'])
      expect(result.discarded).toEqual(['TS_AUTHKEY'])
      expect(readFileSync(envFile, 'utf8')).toContain('tskey_auth_secret_value')
      expect(readFileSync(envFile, 'utf8')).not.toContain('tskey_auth_new_value')
      expect(JSON.stringify(result)).not.toContain('tskey_auth')
    } finally {
      delete process.env.TS_AUTHKEY
    }
  })

  it('writes the file with mode 600', () => {
    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
  })

  it('leaves a secret alone when the form sends an empty string', () => {
    patchConfig(testConfig({ envFile }), { TS_AUTHKEY: '' })
    expect(readFileSync(envFile, 'utf8')).toContain('TS_AUTHKEY=tskey_auth_secret_value')
  })

  it('clears a secret when explicitly asked to', () => {
    patchConfig(testConfig({ envFile }), { TS_AUTHKEY: null })
    expect(readFileSync(envFile, 'utf8')).toContain('TS_AUTHKEY=\n')
    expect(readFileSync(envFile, 'utf8')).not.toContain('tskey_auth_secret_value')
  })

  it('normalises the spellings people write for a boolean', () => {
    patchConfig(testConfig({ envFile }), { TLS_ENABLED: 'yes' })
    expect(readFileSync(envFile, 'utf8')).toContain('TLS_ENABLED=true')
  })

  it('writes nothing at all when one value in the batch is invalid', () => {
    const before = readFileSync(envFile, 'utf8')
    expect(() =>
      patchConfig(testConfig({ envFile }), {
        PORTTA_DOMAIN: 'dev.test',
        PORTTA_HTTP_PORT: '-1',
      }),
    ).toThrow(ValidationError)
    expect(readFileSync(envFile, 'utf8')).toBe(before)
  })

  it('refuses a key that is not in the catalogue', () => {
    expect(() => patchConfig(testConfig({ envFile }), { PATH: '/tmp' })).toThrowError(/not a setting the panel manages/)
    expect(readFileSync(envFile, 'utf8')).not.toContain('PATH=')
  })
})

describe('the config endpoints', () => {
  let dir: string
  let envFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portta-web-api-'))
    envFile = join(dir, '.env')
    writeFileSync(envFile, 'PORTTA_DOMAIN=localhost\nCF_DNS_API_TOKEN=super-secret\n')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('serves the catalogue without any secret in it', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const body = await (await app.request('/api/config')).text()
    expect(body).not.toContain('super-secret')
    const view = JSON.parse(body) as ConfigView
    expect(view.envFile.writable).toBe(true)
    expect(view.groups).toContain('Project access')
  })

  it('saves through PATCH and reports what needs recreating', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_DOMAIN: 'dev.test' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.saved).toEqual(['PORTTA_DOMAIN'])
    expect(result.applyCommand).toContain('portta up')
    expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=dev.test')
  })

  it('discards pending settings through POST', async () => {
    process.env.PORTTA_DOMAIN = 'localhost'
    writeFileSync(envFile, 'PORTTA_DOMAIN=dev.test\nCF_DNS_API_TOKEN=super-secret\n')
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config/discard', {
      method: 'POST',
      body: JSON.stringify({ keys: ['PORTTA_DOMAIN'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.discarded).toEqual(['PORTTA_DOMAIN'])
    expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=localhost')
    expect(JSON.stringify(result)).not.toContain('super-secret')
    delete process.env.PORTTA_DOMAIN
  })

  it('answers 400 with the offending key, and writes nothing', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_HTTP_PORT: 'eighty' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('PORTTA_HTTP_PORT')
    expect(readFileSync(envFile, 'utf8')).not.toContain('eighty')
  })
})

describe('the panel URL is an origin, not a URL with a path', () => {
  it('accepts what a browser would reach the panel on', () => {
    expect(() => validateValue('PORTTA_PANEL_URL', 'https://panel.dev.example.com')).not.toThrow()
    expect(() => validateValue('PORTTA_PANEL_URL', 'http://127.0.0.1:8081')).not.toThrow()
    expect(() => validateValue('PORTTA_PANEL_URL', '')).not.toThrow()
  })

  it('refuses a path, a credential or a scheme that is not http', () => {
    for (const bad of [
      'https://panel.example.com/portta',
      'https://user:pw@panel.example.com',
      'ftp://panel.example.com',
      'panel.example.com',
    ]) {
      expect(() => validateValue('PORTTA_PANEL_URL', bad), bad).toThrow(ValidationError)
    }
  })

  it('checks every entry of the trusted list, and names the one that failed', () => {
    expect(() =>
      validateValue('PORTTA_PANEL_TRUSTED_ORIGINS', 'https://a.example.com, https://b.example.com'),
    ).not.toThrow()
    expect(() => validateValue('PORTTA_PANEL_TRUSTED_ORIGINS', 'https://a.example.com, nonsense')).toThrow(/nonsense/)
  })
})
