import { TUNNEL_STATES, tunnelStatusFrom } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { cliHint, describeProbe, tunnelContainer } from './tunnel.ts'

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
