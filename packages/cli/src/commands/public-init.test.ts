// `portta public init`: the keys it writes, what it refuses, and that the DNS
// token never leaves the file it is written to.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '',
  tcp: false,
  containers: [] as unknown[],
  dockerDown: false,
  yes: true,
}))

vi.mock('../context.js', () => ({
  gatewayContext: () => ({ root: mocks.root, env: {}, config: { tcpEnabled: mocks.tcp }, composeFiles: [] }),
}))
vi.mock('../docker.js', () => ({
  inspectContainers: async () => {
    if (mocks.dockerDown) throw new Error('docker is not running')
    return mocks.containers
  },
}))

import { RefusedError, UsageError } from '../errors.js'
import { setJsonSchema } from '../output.js'
import { publicInit } from './public-init.js'

const TOKEN = 'cf-secret-token-0123456789'
const base = { domain: 'example.com', email: 'ops@example.com' }

function command(json = false): Command {
  return { optsWithGlobals: () => ({ json, yes: mocks.yes }) } as unknown as Command
}

function env(): string {
  return readFileSync(join(mocks.root, '.env'), 'utf8')
}

function value(key: string): string | undefined {
  return env()
    .split('\n')
    .findLast((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1)
}

let out = ''
let err = ''
beforeEach(() => {
  mocks.root = mkdtempSync(join(tmpdir(), 'portta-public-init-'))
  writeFileSync(join(mocks.root, '.env'), 'KEEP_ME=1\nPORTTA_WEB=false\nCF_DNS_API_TOKEN=\n')
  Object.assign(mocks, { tcp: false, containers: [], dockerDown: false, yes: true })
  setJsonSchema('public.init')
  out = ''
  err = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk)
    return true
  })
})
afterEach(() => vi.restoreAllMocks())

describe('public init', () => {
  it('writes exactly the public-server keys and keeps the rest', async () => {
    await publicInit({ ...base, ip: '203.0.113.7' }, command())
    expect(value('KEEP_ME')).toBe('1')
    expect(value('PORTTA_PROFILE')).toBe('remote-public')
    expect(value('PUBLIC_ENABLED')).toBe('true')
    expect(value('PUBLIC_DOMAIN')).toBe('example.com')
    expect(value('PORTTA_DOMAIN_MODE')).toBe('custom')
    expect(value('PORTTA_DOMAIN')).toBe('example.com')
    expect(value('TLS_ENABLED')).toBe('true')
    expect(value('TLS_MODE')).toBe('acme')
    expect(value('ACME_EMAIL')).toBe('ops@example.com')
    expect(value('ACME_DNS_PROVIDER')).toBe('cloudflare')
    expect(value('PORTTA_WEB')).toBe('true')
    expect(value('PORTTA_WEB_EXPOSE')).toBe('domain')
    expect(value('PORTTA_PANEL_ADVERTISED_HOST')).toBe('example.com')
    expect(value('PORTTA_AUTH_MODE')).toBe('required')
    expect(value('CF_DNS_API_TOKEN')).toBe('')
    expect(out).toContain('A\texample.com\t203.0.113.7')
    expect(out).toContain('A\t*.example.com\t203.0.113.7')
    expect(out).toContain('CF_DNS_API_TOKEN is not set')
  })

  it('prints a placeholder without --ip and AAAA for an IPv6 address', async () => {
    await publicInit({ ...base, dryRun: true }, command())
    expect(out).toContain('<server-ip>')
    out = ''
    await publicInit({ ...base, ip: '2001:db8::1', dryRun: true }, command())
    expect(out).toContain('AAAA\t*.example.com\t2001:db8::1')
  })

  it('stores the token from stdin and never prints it', async () => {
    await publicInit({ ...base, cloudflareTokenStdin: true }, command(), {
      readStdin: async () => `${TOKEN}\nignored\n`,
    })
    expect(value('CF_DNS_API_TOKEN')).toBe(TOKEN)
    expect(out + err).not.toContain(TOKEN)
    out = ''
    await publicInit({ ...base, cloudflareTokenStdin: true }, command(true), { readStdin: async () => TOKEN })
    expect(out + err).not.toContain(TOKEN)
    expect(JSON.parse(out).data.tokenSet).toBe(true)
  })

  it('does not echo a malformed token in the error', async () => {
    const bad = 'two words secret'
    const failure = publicInit({ ...base, cloudflareTokenStdin: true }, command(), { readStdin: async () => bad })
    await expect(failure).rejects.toBeInstanceOf(UsageError)
    await expect(failure).rejects.not.toThrow(/secret/)
  })

  it('writes nothing on --dry-run', async () => {
    const before = env()
    await publicInit({ ...base, cloudflareTokenStdin: true, dryRun: true }, command(), { readStdin: async () => TOKEN })
    expect(env()).toBe(before)
    expect(out).toContain('nothing was written')
    expect(out + err).not.toContain(TOKEN)
  })

  it('treats a missing Docker as no containers only on --dry-run', async () => {
    mocks.dockerDown = true
    await publicInit({ ...base, dryRun: true }, command())
    await expect(publicInit(base, command())).rejects.toThrow('docker is not running')
    expect(value('PUBLIC_ENABLED')).toBeUndefined()
  })

  it('accepts a panel host under the domain and rejects others', async () => {
    await publicInit({ ...base, panelHost: 'panel.example.com' }, command())
    expect(value('PORTTA_PANEL_ADVERTISED_HOST')).toBe('panel.example.com')
    await expect(publicInit({ ...base, panelHost: 'panel.other.com' }, command())).rejects.toBeInstanceOf(UsageError)
    await expect(publicInit({ ...base, panelHost: 'badexample.com' }, command())).rejects.toBeInstanceOf(UsageError)
  })

  it.each([
    [{ domain: 'localhost' }],
    [{ domain: 'Example.com' }],
    [{ domain: 'exa mple.com' }],
    [{ email: 'not-an-email' }],
    [{ ip: '999.1.1.1' }],
    [{ domain: undefined }],
    [{ email: undefined }],
  ])('rejects invalid arguments %j before touching anything', async (override) => {
    const before = env()
    await expect(publicInit({ ...base, ...override }, command())).rejects.toBeInstanceOf(UsageError)
    expect(env()).toBe(before)
  })

  it('refuses while TCP entrypoints are enabled', async () => {
    mocks.tcp = true
    await expect(publicInit(base, command())).rejects.toBeInstanceOf(RefusedError)
    expect(value('PUBLIC_ENABLED')).toBeUndefined()
  })

  it('refuses while a running service routes with no login gate', async () => {
    mocks.containers = [{ name: 'shop-web', state: 'running', labels: { 'traefik.enable': 'true' }, ports: [] }]
    await expect(publicInit(base, command())).rejects.toThrow(/shop-web/)
    expect(value('PUBLIC_ENABLED')).toBeUndefined()
  })

  it('changes nothing the second time', async () => {
    await publicInit({ ...base, cloudflareTokenStdin: true }, command(true), { readStdin: async () => TOKEN })
    const first = env()
    out = ''
    await publicInit({ ...base, cloudflareTokenStdin: true }, command(true), { readStdin: async () => TOKEN })
    expect(env()).toBe(first)
    const data = JSON.parse(out).data
    expect(data.written).toBe(false)
    expect(data.keys).toEqual([])
  })
})
