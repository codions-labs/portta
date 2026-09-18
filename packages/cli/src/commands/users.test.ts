import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requests: [] as { method: string; url: string; body: unknown }[],
  answers: [] as unknown[],
  stdin: '',
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
// `readFileSync(0)` is how a password arrives without touching a command line.
// The module is mocked rather than spied on: an ESM namespace is frozen.
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  readFileSync: (target: unknown) => {
    if (target !== 0) throw new Error(`unexpected readFileSync in this suite: ${String(target)}`)
    return mocks.stdin
  },
}))

import { usersCreate, usersGrant, usersRemove, usersRevoke, usersSetPassword, usersSetRole } from './users.js'

const PEOPLE = [
  { id: 'u1', name: 'Ada', email: 'ada@example.test', role: 'owner', banned: false, projects: [] },
  {
    id: 'u2',
    name: 'Grace',
    email: 'grace@example.test',
    role: 'developer',
    banned: false,
    projects: [{ id: '7', slug: 'shop' }],
  },
]

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

let stdout = ''
afterEach(() => {
  vi.restoreAllMocks()
  mocks.requests.length = 0
  mocks.answers.length = 0
  stdout = ''
  mocks.stdin = ''
})

function stubFetch(...answers: unknown[]) {
  mocks.answers.push(...answers)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    mocks.requests.push({
      method: init.method ?? 'GET',
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    const answer = mocks.answers.shift() ?? {}
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

describe('portta users', () => {
  // The rules about who may create whom live in the panel. What the CLI must
  // not do is put a password on a command line.
  it('generates a password, sends it once, and shows it once', async () => {
    stubFetch({ ...PEOPLE[1], email: 'new@example.test', role: 'viewer' })
    await usersCreate({ name: 'New', email: 'new@example.test' }, command())

    const sent = mocks.requests[0]!.body as { password: string; role: string }
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/users' })
    expect(sent.role).toBe('viewer')
    expect(sent.password.length).toBeGreaterThanOrEqual(20)
    expect(JSON.parse(stdout).data.password).toBe(sent.password)
  })

  it('refuses a role that is not one, before asking the panel', async () => {
    stubFetch()
    await expect(usersCreate({ name: 'x', email: 'x@example.test', role: 'root' }, command())).rejects.toThrow(
      /owner, admin/,
    )
    expect(mocks.requests).toHaveLength(0)
  })

  // A person types an email; the API takes an id. Resolving it here is what
  // makes `portta users set-role ada@example.test admin` work at all.
  it('finds the account by email before changing its role', async () => {
    stubFetch({ users: PEOPLE }, { ...PEOPLE[1], role: 'admin' })
    await usersSetRole('grace@example.test', 'admin', {}, command())
    expect(mocks.requests[1]).toMatchObject({
      method: 'PATCH',
      url: 'http://127.0.0.1:8081/api/users/u2/role',
      body: { role: 'admin' },
    })
  })

  it('says which email it could not find, and asks the panel nothing else', async () => {
    stubFetch({ users: PEOPLE })
    await expect(usersRemove('nobody@example.test', {}, command())).rejects.toThrow(/nobody@example.test/)
    expect(mocks.requests).toHaveLength(1)
  })

  it('reads a password from stdin when told to, and never generates one then', async () => {
    stubFetch({ users: PEOPLE }, { ok: true })
    mocks.stdin = 'a-password-typed-by-hand\n'
    await usersSetPassword('grace@example.test', { passwordStdin: true }, command())
    expect(mocks.requests[1]!.body).toEqual({ password: 'a-password-typed-by-hand' })
    expect(JSON.parse(stdout).data.password).toBeUndefined()
  })
})

describe('portta users grant and revoke', () => {
  const PROJECTS = {
    projects: [
      { id: '7', slug: 'shop' },
      { id: '9', slug: 'store' },
    ],
  }

  // The API takes the whole list, so grant is "what they had, plus this one".
  // Sending only the addition would silently take the rest away.
  it('sends the whole list with the new Project in it', async () => {
    stubFetch({ users: PEOPLE }, PROJECTS, {
      ...PEOPLE[1],
      projects: [
        { id: '7', slug: 'shop' },
        { id: '9', slug: 'store' },
      ],
    })
    await usersGrant('grace@example.test', 'store', {}, command())
    expect(mocks.requests[2]).toMatchObject({
      method: 'PUT',
      url: 'http://127.0.0.1:8081/api/users/u2/projects',
      body: { projects: [7, 9] },
    })
  })

  it('sends the whole list without the removed one', async () => {
    stubFetch({ users: PEOPLE }, PROJECTS, { ...PEOPLE[1], projects: [] })
    await usersRevoke('grace@example.test', 'shop', {}, command())
    expect(mocks.requests[2]!.body).toEqual({ projects: [] })
  })

  it('refuses a Project that does not exist, before writing anything', async () => {
    stubFetch({ users: PEOPLE }, PROJECTS)
    await expect(usersGrant('grace@example.test', 'nowhere', {}, command())).rejects.toThrow(/nowhere/)
    expect(mocks.requests).toHaveLength(2)
  })
})
