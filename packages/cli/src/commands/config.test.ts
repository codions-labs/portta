// Turning the login on and off, and the combinations the CLI refuses.
//
// The rule itself is `resolveSecurityMode`'s and is tested there. What is
// tested here is that the CLI reaches the same verdict *before* writing, so an
// operator learns it in the terminal they are looking at rather than from a
// container that will not come up — which is the whole reason this validation
// exists twice (ADR 0051).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '',
  env: {} as Record<string, string>,
  applied: [] as string[][],
}))

vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: mocks.root,
    env: mocks.env,
    config: { profile: 'local', tlsEnabled: false, tailscaleEnabled: false, domainMode: 'local' },
    composeFiles: [],
    version: 'test',
  }),
  composeArguments: () => [],
}))
// `set` reapplies the components it changed. Nothing here is about Docker.
vi.mock('../process.js', () => ({
  runProcess: async (_file: string, args: string[]) => {
    mocks.applied.push(args)
    return { stdout: '', stderr: '', exitCode: 0, failed: false }
  },
}))
vi.mock('./web.js', () => ({ syncForwardAuth: () => undefined }))

import { RefusedError } from '../errors.js'
import { configSet } from './config.js'

function command(): Command {
  return { optsWithGlobals: () => ({ json: false, quiet: true }) } as unknown as Command
}

/** The value `.env` ends up holding, which is the only thing that outlives the command. */
function written(key: string): string | undefined {
  const line = readFileSync(join(mocks.root, '.env'), 'utf8')
    .split('\n')
    .findLast((entry) => entry.startsWith(`${key}=`))
  return line?.slice(key.length + 1)
}

beforeEach(() => {
  mocks.root = mkdtempSync(join(tmpdir(), 'portta-config-'))
  writeFileSync(join(mocks.root, '.env'), 'PORTTA_WEB=true\n')
  mocks.env = {
    PORTTA_WEB: 'true',
    PORTTA_WEB_EXPOSE: 'local',
    PORTTA_WEB_BIND_ADDRESS: '127.0.0.1',
    PORTTA_AUTH_MODE: 'disabled',
  }
  mocks.applied.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('turning the panel login on and off', () => {
  it('goes both ways on a loopback panel', async () => {
    await configSet('panel.auth', 'required', {}, command())
    expect(written('PORTTA_AUTH_MODE')).toBe('required')

    mocks.env.PORTTA_AUTH_MODE = 'required'
    await configSet('panel.auth', 'disabled', {}, command())
    expect(written('PORTTA_AUTH_MODE')).toBe('disabled')
  })

  it('applies the change rather than leaving it for the next restart', async () => {
    await configSet('panel.auth', 'required', {}, command())
    expect(mocks.applied.some((args) => args.includes('up'))).toBe(true)
  })

  it('leaves it for the next restart when told to', async () => {
    await configSet('panel.auth', 'required', { apply: false }, command())
    expect(mocks.applied).toEqual([])
    expect(written('PORTTA_AUTH_MODE')).toBe('required')
  })
})

describe('the combinations it refuses, before writing anything', () => {
  it.each(['public', 'domain'])('refuses no login on a panel reached over %s', async (expose) => {
    mocks.env.PORTTA_WEB_EXPOSE = expose
    mocks.env.PORTTA_AUTH_MODE = 'required'
    await expect(configSet('panel.auth', 'disabled', {}, command())).rejects.toBeInstanceOf(RefusedError)
    expect(written('PORTTA_AUTH_MODE')).toBeUndefined()
    expect(mocks.applied).toEqual([])
  })

  it.each(['tailscale', 'vpn'])('accepts no login on a panel reached over %s', async (expose) => {
    mocks.env.PORTTA_WEB_EXPOSE = expose
    mocks.env.PORTTA_AUTH_MODE = 'required'
    await configSet('panel.auth', 'disabled', {}, command())
    expect(written('PORTTA_AUTH_MODE')).toBe('disabled')
  })

  // The one case the access mode does not settle: `local` is loopback by
  // construction, so a LAN address there is an operator's own doing.
  it('refuses no login on the local network until it is named', async () => {
    mocks.env.PORTTA_WEB_BIND_ADDRESS = '192.168.1.10'
    mocks.env.PORTTA_AUTH_MODE = 'required'
    await expect(configSet('panel.auth', 'disabled', {}, command())).rejects.toThrow(/every device on this network/)

    mocks.env.PORTTA_AUTH_ALLOW_LAN = 'true'
    await configSet('panel.auth', 'disabled', {}, command())
    expect(written('PORTTA_AUTH_MODE')).toBe('disabled')
  })

  // The same rule from the other side: somebody exposing a panel that answers
  // everybody as the local operator is the mistake this pair exists to catch.
  it.each(['public', 'domain'])('refuses exposing a panel with no login over %s', async (expose) => {
    await expect(configSet('panel.access', expose, {}, command())).rejects.toBeInstanceOf(RefusedError)
    expect(written('PORTTA_WEB_EXPOSE')).toBeUndefined()
  })

  it('refuses a value the setting does not name', async () => {
    await expect(configSet('panel.auth', 'maybe', {}, command())).rejects.toThrow(/must be one of/)
  })
})
