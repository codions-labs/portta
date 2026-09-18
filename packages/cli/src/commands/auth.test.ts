import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requests: [] as { method: string; url: string; headers: Record<string, string>; body: unknown }[],
  answers: [] as { status: number; body: unknown }[],
}))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: '/tmp/portta',
    env: { PORTTA_WEB_PORT: '8081' },
    config: {},
    composeFiles: [],
    version: 'test',
  }),
}))

import { findCredential, saveCredential } from '../credentials.js'
import { authLogin, authLogout, authStatus, authWhoami } from './auth.js'

const ME = {
  kind: 'token',
  name: 'Ada',
  email: 'ada@example.test',
  role: 'developer',
  actor: 'ci',
  permissions: ['issue:read', 'issue:write'],
  scope: [1],
  projects: [{ slug: 'shop' }],
  tokenId: 't1',
}

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

let stdout = ''
let store = ''

beforeEach(() => {
  store = join(mkdtempSync(join(tmpdir(), 'portta-auth-')), 'credentials.json')
  process.env.PORTTA_CREDENTIALS = store
})

afterEach(() => {
  vi.restoreAllMocks()
  mocks.requests.length = 0
  mocks.answers.length = 0
  stdout = ''
  delete process.env.PORTTA_CREDENTIALS
})

function stubFetch(...answers: { status: number; body: unknown }[]) {
  mocks.answers.push(...answers)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    mocks.requests.push({
      method: init.method ?? 'GET',
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    const answer = mocks.answers.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  // Hints go to stderr; the assertions here are about what a person is told,
  // wherever it was written.
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
}

describe('portta auth login', () => {
  // Saving a token without checking it produces a file that looks right and
  // fails on the next command, when nobody remembers this one.
  it('checks the token against the panel before saving it', async () => {
    stubFetch({ status: 200, body: ME })
    await authLogin({ token: 'ptt_secret' }, command())

    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/auth/me' })
    expect(mocks.requests[0]!.headers.authorization).toBe('Bearer ptt_secret')
    expect(findCredential('http://127.0.0.1:8081', store)).toMatchObject({
      token: 'ptt_secret',
      user: 'ada@example.test',
      role: 'developer',
    })
  })

  it('saves nothing when the panel refuses it', async () => {
    stubFetch({ status: 401, body: { error: 'this request carries no credential' } })
    await expect(authLogin({ token: 'ptt_wrong' }, command())).rejects.toThrow(/did not accept that token/)
    expect(findCredential('http://127.0.0.1:8081', store)).toBeNull()
  })

  it('refuses something that is not a Portta token, before asking the panel', async () => {
    stubFetch()
    await expect(authLogin({ token: 'github_pat_x' }, command())).rejects.toThrow(/does not look like a Portta token/)
    expect(mocks.requests).toHaveLength(0)
  })

  it('never prints the token back', async () => {
    stubFetch({ status: 200, body: ME })
    await authLogin({ token: 'ptt_secret' }, command())
    expect(stdout).not.toContain('ptt_secret')
  })
})

describe('portta auth status', () => {
  it('says who the saved credential makes you', async () => {
    saveCredential(
      'http://127.0.0.1:8081',
      { token: 'ptt_secret', user: 'ada@example.test', role: 'developer', savedAt: 'now' },
      store,
    )
    stubFetch({ status: 200, body: { mode: 'protected', setupRequired: false } }, { status: 200, body: ME })
    await authStatus({}, command())

    const printed = JSON.parse(stdout).data
    expect(printed).toMatchObject({ signedIn: true, user: 'ada@example.test', role: 'developer', permissions: 2 })
    expect(printed.projects).toEqual(['shop'])
  })

  it('says not signed in when the panel refuses what is saved', async () => {
    stubFetch({ status: 200, body: { mode: 'protected', setupRequired: false } }, { status: 401, body: {} })
    await authStatus({}, command())
    expect(JSON.parse(stdout).data).toMatchObject({ signedIn: false })
  })
})

describe('portta auth logout', () => {
  // Forgetting a token is not revoking it, and a message that implied otherwise
  // would leave somebody thinking a lost laptop was handled.
  it('forgets the credential and says the token still works', async () => {
    saveCredential('http://127.0.0.1:8081', { token: 'ptt_secret', user: 'ada', role: 'owner', savedAt: 'now' }, store)
    stubFetch()
    await authLogout({}, command({ json: false }))
    expect(findCredential('http://127.0.0.1:8081', store)).toBeNull()
    expect(stdout).toContain('still works')
  })
})

describe('portta auth whoami', () => {
  it('lists the panels this host has a credential for, and never the secrets', async () => {
    saveCredential('http://127.0.0.1:8081', { token: 'ptt_one', user: 'ada', role: 'owner', savedAt: 'now' }, store)
    saveCredential(
      'https://panel.example.com',
      { token: 'ptt_two', user: 'grace', role: 'developer', savedAt: 'now' },
      store,
    )
    stubFetch()
    await authWhoami({}, command())

    expect(stdout).not.toContain('ptt_one')
    expect(stdout).not.toContain('ptt_two')
    expect(JSON.parse(stdout).data.panels).toHaveLength(2)
  })
})
