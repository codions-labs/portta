// The boundaries, one per row of the threat model.
//
// Each of these is a rule that lives in exactly one place and is easy to lose
// in a refactor: the origin guard, read-only mode, the difference between 401
// and 403, the credential shapes the panel refuses, the rate limit in front of
// guessing, and the promise that nothing secret reaches a log.

import type { Hono } from 'hono'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import type { Db } from 'portta-db'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cheapPasswords, makeProtectedApp, type SeededDatabase, seededDatabase, signInAs } from '../helpers.ts'

const PASSWORD = 'a-long-enough-password'

let seeded: SeededDatabase
let panel: ReturnType<typeof makeProtectedApp>
let app: Hono
let db: Db
let cookie: Record<string, string>
let token: string

const json = (response: Response) => response.json() as Promise<Record<string, any>>

beforeAll(async () => {
  seeded = await seededDatabase()
  panel = makeProtectedApp(seeded.database)
  app = panel.app
  db = panel.db

  const security = resolveSecurityMode({
    PORTTA_AUTH_MODE: 'required',
    PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
  })
  await bootstrapOwner(
    (handle) => createAuth({ db: handle, security, hasOwner: () => hasOwner(handle), password: cheapPasswords }),
    db,
    { name: 'Ada', email: 'security@example.test', password: PASSWORD },
    new Headers(),
  )
  cookie = await signInAs(panel.auth, 'security@example.test', PASSWORD)
  // `human`, so it holds the owner's whole role: this suite is about the guard
  // in front of a write, not about what an agent's token is narrowed to.
  const created = await json(
    await app.request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'security-suite', actorKind: 'human' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
    }),
  )
  token = created.token
})

afterEach(() => {
  vi.restoreAllMocks()
})

// A page on another site can point a form at 127.0.0.1. Reads are harmless
// enough behind loopback; a write is not.
describe('the origin guard', () => {
  it('refuses a cookie write from another origin', async () => {
    const response = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ slug: 'evil', name: 'Evil' }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost', ...cookie },
    })
    expect(response.status).toBe(403)
  })

  it('accepts a write from the panel itself', async () => {
    const response = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ slug: 'origin-ok', name: 'Origin ok' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
    })
    expect(response.status).toBe(201)
  })

  // A CLI sends no Origin, and a token is not a credential a browser attaches
  // to a cross-site request on its own.
  it('lets a token write with no Origin at all', async () => {
    const response = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ slug: 'from-a-token', name: 'From a token' }),
      headers: { 'content-type': 'application/json', host: 'localhost', authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(201)
  })

  // Found writing this suite: an agent's token is narrowed to what agents hold,
  // which is a developer minus three, and a developer does not create Projects.
  it('and a token narrowed to an agent still cannot do what its owner could', async () => {
    const agent = await json(
      await app.request('/api/auth/tokens', {
        method: 'POST',
        body: JSON.stringify({ name: 'an-agent' }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
      }),
    )
    const response = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ slug: 'agents-do-not-do-this', name: 'Nope' }),
      headers: { 'content-type': 'application/json', host: 'localhost', authorization: `Bearer ${agent.token}` },
    })
    expect(response.status).toBe(403)
  })

  it('and never refuses a read for want of an Origin', async () => {
    const response = await app.request('/api/projects', {
      headers: { origin: 'https://evil.example', host: 'localhost', ...cookie },
    })
    expect(response.status).toBe(200)
  })
})

describe('what a credential has to look like', () => {
  it('ignores x-api-key, whatever the plugin would do with it', async () => {
    const response = await app.request('/api/auth/me', { headers: { 'x-api-key': token } })
    expect(response.status).toBe(401)
  })

  it('ignores a Bearer that is not a Portta token', async () => {
    const response = await app.request('/api/auth/me', { headers: { authorization: 'Bearer not-a-portta-token' } })
    expect(response.status).toBe(401)
  })
})

// Guessing is the attack on these, and an in-memory window is enough to make
// it expensive on a single instance.
describe('the rate limit in front of guessing', () => {
  it('stops a run of sign-in attempts', async () => {
    const attempt = () =>
      app.request('/api/auth/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'security@example.test', password: 'wrong-password' }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
      })
    const codes: number[] = []
    for (let index = 0; index < 8; index += 1) codes.push((await attempt()).status)
    expect(codes).toContain(429)
    // And it is the limit, not the credential: none of them was accepted.
    expect(codes).not.toContain(200)
  })
})

// A credential in a log is a credential on a shared disk, in a shipper, and in
// whatever reads it later.
describe('what reaches the output', () => {
  it('never prints a cookie, a token or a password', async () => {
    const written: string[] = []
    const capture = (chunk: unknown) => {
      written.push(String(chunk))
      return true
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(capture as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(capture as never)
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      written.push(args.join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      written.push(args.join(' '))
    })

    await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'security@example.test', password: PASSWORD }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    const created = await json(
      await app.request('/api/auth/tokens', {
        method: 'POST',
        body: JSON.stringify({ name: 'log-check' }),
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
      }),
    )

    const output = written.join('\n')
    expect(output).not.toContain(PASSWORD)
    expect(output).not.toContain(created.token)
    expect(output).not.toContain(cookie.cookie ?? 'no-cookie-in-this-run')
    expect(output).not.toMatch(/portta\.session_token=/)
  })
})
