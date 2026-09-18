// Whose token is whose.
//
// What a token holds is decided in `portta-auth-core` and has its own suite.
// What these routes add is ownership: your own tokens are yours to make and
// revoke, and somebody else's are an administrator's business.

import type { Hono } from 'hono'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import type { Db } from 'portta-db'
import { beforeAll, describe, expect, it } from 'vitest'
import { cheapPasswords, makeProtectedApp, type SeededDatabase, seededDatabase, signInAs } from './helpers.ts'

const PASSWORD = 'a-long-enough-password'

let seeded: SeededDatabase
let panel: ReturnType<typeof makeProtectedApp>
let app: Hono
let db: Db
const cookies: Record<string, Record<string, string>> = {}
const ids: Record<string, string> = {}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

function send(method: string, path: string, as: string, body?: unknown) {
  return app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookies[as] },
  })
}

const get = (path: string, as: string) => app.request(path, { headers: cookies[as] })
const bearer = (token: string) => app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })

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
    { name: 'Ada', email: 'owner@example.test', password: PASSWORD },
    new Headers(),
  )
  cookies.owner = await signInAs(panel.auth, 'owner@example.test', PASSWORD)

  const dev = await json(
    await send('POST', '/api/users', 'owner', {
      name: 'Grace',
      email: 'dev@example.test',
      password: PASSWORD,
      role: 'developer',
    }),
  )
  ids.developer = dev.id
  cookies.dev = await signInAs(panel.auth, 'dev@example.test', PASSWORD)
})

describe('creating one', () => {
  it('shows the secret once, and it works as the person who made it', async () => {
    const created = await json(await send('POST', '/api/auth/tokens', 'dev', { name: 'laptop' }))
    expect(created.token).toMatch(/^ptt_/)
    expect(created.credential).toMatchObject({
      name: 'laptop',
      actorKind: 'agent',
      enabled: true,
      user: 'dev@example.test',
    })
    expect(created.credential.start).not.toBe(created.token)

    const me = await json(await bearer(created.token))
    expect(me).toMatchObject({ kind: 'token', role: 'developer', email: 'dev@example.test' })
  })

  it('refuses a scope the maker does not hold, and names it', async () => {
    const refused = await send('POST', '/api/auth/tokens', 'dev', {
      name: 'too much',
      scopes: ['issue:read', 'settings:manage'],
    })
    expect(refused.status).toBe(400)
    expect((await json(refused)).error).toContain('settings:manage')
  })

  it('carries exactly the scopes it was given, and no more', async () => {
    const created = await json(
      await send('POST', '/api/auth/tokens', 'dev', {
        name: 'reader',
        scopes: ['issue:read'],
      }),
    )
    const me = await json(await bearer(created.token))
    expect(me.permissions).toEqual(['issue:read'])
  })
})

describe('listing', () => {
  it('is yours by default', async () => {
    const mine = await json(await get('/api/auth/tokens', 'dev'))
    expect(mine.tokens.every((token: { user: string }) => token.user === 'dev@example.test')).toBe(true)

    const owner = await json(await get('/api/auth/tokens', 'owner'))
    expect(owner.tokens).toEqual([])
  })

  it('is everybody’s only for somebody who administers accounts', async () => {
    const all = await json(await get('/api/auth/tokens?all=true', 'owner'))
    expect(all.tokens.some((token: { user: string }) => token.user === 'dev@example.test')).toBe(true)

    expect((await get('/api/auth/tokens?all=true', 'dev')).status).toBe(403)
  })
})

describe('revoking', () => {
  it('stops the next request that carries it', async () => {
    const created = await json(await send('POST', '/api/auth/tokens', 'dev', { name: 'short-lived' }))
    expect((await bearer(created.token)).status).toBe(200)

    expect((await send('DELETE', `/api/auth/tokens/${created.credential.id}`, 'dev')).status).toBe(200)
    expect((await bearer(created.token)).status).toBe(401)
  })

  it("is refused on somebody else's without user:update", async () => {
    const ownerToken = await json(await send('POST', '/api/auth/tokens', 'owner', { name: 'owners' }))
    const refused = await send('DELETE', `/api/auth/tokens/${ownerToken.credential.id}`, 'dev')
    expect(refused.status).toBe(403)
    expect((await bearer(ownerToken.token)).status).toBe(200)

    // And allowed for an administrator, which is what makes a lost laptop
    // recoverable by somebody other than whoever lost it.
    const devToken = await json(await send('POST', '/api/auth/tokens', 'dev', { name: 'lost' }))
    expect((await send('DELETE', `/api/auth/tokens/${devToken.credential.id}`, 'owner')).status).toBe(200)
    expect((await bearer(devToken.token)).status).toBe(401)
  })

  it('answers 404 for a token that never existed', async () => {
    expect((await send('DELETE', '/api/auth/tokens/nothing', 'owner')).status).toBe(404)
  })
})

describe('a token that outlives its owner’s standing', () => {
  it('stops when the role no longer holds what it was scoped to', async () => {
    const created = await json(
      await send('POST', '/api/auth/tokens', 'dev', {
        name: 'writer',
        scopes: ['issue:write'],
      }),
    )
    expect((await json(await bearer(created.token))).permissions).toEqual(['issue:write'])

    await send('PATCH', `/api/users/${ids.developer}/role`, 'owner', { role: 'viewer' })
    // The token was never touched. What it holds is recomputed per request, so
    // it now holds nothing a viewer does not.
    expect((await json(await bearer(created.token))).permissions).toEqual([])

    await send('PATCH', `/api/users/${ids.developer}/role`, 'owner', { role: 'developer' })
  })

  it('stops entirely when its owner is banned', async () => {
    const created = await json(await send('POST', '/api/auth/tokens', 'dev', { name: 'banned-soon' }))
    expect((await bearer(created.token)).status).toBe(200)

    await send('PATCH', `/api/users/${ids.developer}/ban`, 'owner', { banned: true })
    expect((await bearer(created.token)).status).toBe(401)

    await send('PATCH', `/api/users/${ids.developer}/ban`, 'owner', { banned: false })
  })
})
