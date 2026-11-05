import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { BRIDGE_IMAGE, loadGatewayConfig, TUNNEL_STATES, tunnelStatusFrom } from 'portta-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayContext } from '../context.js'

const mocks = vi.hoisted(() => ({ gatewayContext: vi.fn(), runProcess: vi.fn() }))
vi.mock('../context.js', () => ({ gatewayContext: mocks.gatewayContext, composeArguments: () => [] }))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))

import { cliHint, describeProbe, tunnelContainer, tunnelEnable, tunnelPaths } from './tunnel.ts'

describe('tunnel enable prepares the panel bridge', () => {
  let root: string
  let context: GatewayContext
  const command = { optsWithGlobals: () => ({ quiet: true }) } as unknown as Command

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'portta-tunnel-bridge-'))
    writeFileSync(join(root, '.env'), 'PORTTA_WEB=true\n')
    const env = { PORTTA_WEB: 'true', DOCKER_HOST: 'unix:///run/test-docker.sock' }
    context = { root, env, config: loadGatewayConfig(env), composeFiles: [], version: 'test' }
    mocks.gatewayContext.mockReset().mockReturnValue(context)
    mocks.runProcess.mockReset()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('refuses to start containers when the panel bridge image cannot be prepared', async () => {
    const paths = tunnelPaths(root)
    mkdirSync(paths.directory, { recursive: true })
    writeFileSync(paths.config, 'ingress: []\n')
    writeFileSync(paths.credentials, '{}\n')
    mocks.runProcess.mockResolvedValue({ stdout: '', stderr: 'registry unavailable', exitCode: 1, failed: true })

    await expect(tunnelEnable(command)).rejects.toThrow(/registry unavailable/)

    expect(mocks.runProcess).toHaveBeenCalledWith('docker', ['pull', BRIDGE_IMAGE], {
      env: context.env,
      reject: false,
      stdio: 'stream',
    })
    expect(mocks.runProcess.mock.calls.some(([, args]) => args[0] === 'compose')).toBe(false)
  })

  it('refuses an unconfigured connector before preparing any image', async () => {
    await expect(tunnelEnable(command)).rejects.toThrow(/connector is not configured/)

    expect(mocks.runProcess).not.toHaveBeenCalled()
  })
})

describe('tunnelContainer', () => {
  it('follows the Compose project name, so two gateways on one host do not collide', () => {
    expect(tunnelContainer({})).toBe('portta-cloudflared-1')
    expect(tunnelContainer({ PORTTA_PROJECT_NAME: 'staging' })).toBe('staging-cloudflared-1')
    expect(tunnelContainer({ PORTTA_PROJECT_NAME: '' })).toBe('portta-cloudflared-1')
  })
})

describe('describeProbe', () => {
  // 404 is the success case, and the least obvious thing about this command:
  // a name nothing routes to, answered by Traefik, proves the whole path
  // without needing a live service to exist.
  it('reads 404 as proof the whole path works', () => {
    const verdict = describeProbe(404)
    expect(verdict.ok).toBe(true)
    expect(verdict.detail).toContain('carrying traffic')
    expect(verdict.detail).toContain('404 is correct here')
  })
})

describe('cliHint', () => {
  const status = (state: (typeof TUNNEL_STATES)[number]) => ({
    state,
    detail: '',
    hint: 'Settings -> Cloudflare Tunnel',
  })

  it('never leaves a panel page name in a terminal hint', () => {
    for (const state of TUNNEL_STATES) {
      const hint = cliHint(status(state))
      if (hint) expect(hint).not.toContain('Settings ->')
    }
  })
})

// The command reads its inputs from Docker and the filesystem; the verdict
// itself is core's. This is the join: every state the command can print comes
// from an input shape the command actually produces.
describe('every state the command can print is reachable from what it observes', () => {
  const base = {
    tokenConfigured: true,
    zoneConfigured: true,
    enabled: true,
    containerState: 'running',
    containerHealth: null,
    logTail: '',
  }

  it('covers the whole enumeration', () => {
    const reached = new Set([
      tunnelStatusFrom({ ...base, tokenConfigured: false }).state,
      tunnelStatusFrom({ ...base, enabled: false }).state,
      tunnelStatusFrom({ ...base, logTail: 'Unauthorized' }).state,
      tunnelStatusFrom({ ...base, logTail: "Couldn't start tunnel" }).state,
      tunnelStatusFrom({ ...base, containerState: null }).state,
      tunnelStatusFrom({ ...base, logTail: 'Registered tunnel connection 0' }).state,
      tunnelStatusFrom({ ...base, containerHealth: 'starting' }).state,
    ])
    expect([...reached].sort()).toEqual([...TUNNEL_STATES].sort())
  })
})
