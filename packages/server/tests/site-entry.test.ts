// A protected site asks the panel whether the browser's session may open it. The answer is always a
// redirect back to the address the protection store holds for that host: with a token when the
// session may see the project behind it, and with the reason when not.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import {
  emptyProtectionStore,
  readProtectionStore,
  readSiteEntry,
  setProtection,
  writeProtectionStore,
} from 'portta-core'
import { projectEnvironments, projects as projectsTable } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { cheapPasswords, makeApp, makeProtectedApp, seededDatabase, signInAs } from './helpers.ts'

const PASSWORD = 'a-long-enough-password'
const SECRET = 'ab'.repeat(32)

async function panel() {
  const seeded = await seededDatabase()
  const dir = mkdtempSync(join(tmpdir(), 'portta-site-entry-'))
  const authStore = join(dir, 'protections.json')
  const hash = '$portta$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  let store = emptyProtectionStore()
  const base = { entryPoints: ['websecure'], mode: 'protected' as const, hash }
  store = setProtection(store, {
    ...base,
    scope: 'host:mine.example.com',
    host: 'mine.example.com',
    label: 'mine',
    project: 'alpha',
  })
  store = setProtection(store, {
    ...base,
    scope: 'host:theirs.example.com',
    host: 'theirs.example.com',
    label: 'theirs',
    project: 'beta',
  })
  store = setProtection(store, { ...base, scope: 'share:a7f3', host: 'share.example.com', label: 'a share' })
  store = setProtection(store, {
    entryPoints: ['websecure'],
    mode: 'public',
    scope: 'host:open.example.com',
    host: 'open.example.com',
    label: 'open',
  })
  writeProtectionStore(authStore, store)

  const p = makeProtectedApp(seeded.database, { authStore, dynamicDir: dir, authSecret: SECRET, tlsEnabled: true })
  const security = resolveSecurityMode({
    PORTTA_AUTH_MODE: 'required',
    PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
  })
  await bootstrapOwner(
    (handle) => createAuth({ db: handle, security, hasOwner: () => hasOwner(handle), password: cheapPasswords }),
    p.db,
    { name: 'Ada', email: 'owner@example.test', password: PASSWORD },
    new Headers(),
  )
  const owner = await signInAs(p.auth, 'owner@example.test', PASSWORD)

  const [other] = await p.db
    .insert(projectsTable)
    .values({ slug: 'outro', name: 'Outro' })
    .returning({ id: projectsTable.id })
  await p.db
    .insert(projectEnvironments)
    .values({ projectId: Number(seeded.ids.project), environmentId: Number(seeded.ids.environment), source: 'manual' })
  void other

  const ask = (path: string, cookies: Record<string, string> = {}) => p.app.request(path, { headers: cookies })
  const asOwner = (method: string, path: string, body: unknown) =>
    p.app.request(path, {
      method,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...owner },
    })
  return { ask, owner, p, seeded, asOwner }
}

const STATE = 's'.repeat(24)
const entry = (host: string, extra = '') => `/api/site-entry?host=${host}&next=%2Forders&state=${STATE}${extra}`

describe('a panel session opening a protected site', () => {
  it('sends the owner back with a token for that host and decision', async () => {
    const { ask, owner } = await panel()
    const response = await ask(entry('mine.example.com'), owner)
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe('https://mine.example.com/__portta/auth/panel')
    expect(location.searchParams.get('next')).toBe('/orders')
    const token = readSiteEntry(location.searchParams.get('token') ?? '', SECRET, Math.floor(Date.now() / 1000))
    expect(token).toMatchObject({
      host: 'mine.example.com',
      scope: 'host:mine.example.com',
      user: 'owner@example.test',
      state: STATE,
    })
  })

  it('sends a browser with no session back to the password form, saying so', async () => {
    const { ask } = await panel()
    const response = await ask(entry('mine.example.com'))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://mine.example.com/__portta/auth/login?next=%2Forders&panel=signedOut',
    )
  })

  it('never returns to an address the request supplies', async () => {
    const { ask, owner } = await panel()
    const response = await ask(
      `/api/site-entry?host=mine.example.com&next=https%3A%2F%2Fevil.example&state=${STATE}`,
      owner,
    )
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.host).toBe('mine.example.com')
    expect(location.searchParams.get('next')).toBe('/')
    expect((await ask(entry('evil.example'), owner)).status).toBe(404)
    expect((await ask('/api/site-entry?host=%2F%2Fevil', owner)).status).toBe(400)
  })

  it('has nothing to say about a host that asks for no login', async () => {
    const { ask, owner } = await panel()
    expect((await ask(entry('open.example.com'), owner)).status).toBe(404)
  })

  it('opens a share only for somebody who sees everything', async () => {
    const { ask, owner } = await panel()
    const response = await ask(entry('share.example.com'), owner)
    expect(response.headers.get('location')).toContain('/__portta/auth/panel?token=')
  })

  it('opens a project only for somebody who is a member of it', async () => {
    const { ask, asOwner, p, seeded } = await panel()
    const created = (await (
      await asOwner('POST', '/api/users', {
        name: 'Grace',
        email: 'dev@example.test',
        password: PASSWORD,
        role: 'developer',
      })
    ).json()) as { id: string }
    const developer = await signInAs(p.auth, 'dev@example.test', PASSWORD)

    const refused = await ask(entry('mine.example.com'), developer)
    expect(refused.headers.get('location')).toBe(
      'https://mine.example.com/__portta/auth/login?next=%2Forders&panel=denied',
    )

    await asOwner('PUT', `/api/users/${created.id}/projects`, { projects: [Number(seeded.ids.project)] })
    const allowed = await ask(entry('mine.example.com'), developer)
    expect(allowed.headers.get('location')).toContain('/__portta/auth/panel?token=')

    // Another project's host, and a share that no project owns, stay closed to them.
    expect((await ask(entry('theirs.example.com'), developer)).headers.get('location')).toContain('panel=denied')
    expect((await ask(entry('share.example.com'), developer)).headers.get('location')).toContain('panel=denied')
  })

  it('takes the scheme from how the gateway is served and ignores what a link asks for', async () => {
    const { ask, owner } = await panel()
    const response = await ask(`${entry('mine.example.com')}&proto=http`, owner)
    expect(response.headers.get('location')).toMatch(/^https:\/\/mine\.example\.com\//)
  })

  it('wants the state of the browser that asked, so a token cannot be put in another', async () => {
    const { ask, owner } = await panel()
    expect((await ask('/api/site-entry?host=mine.example.com&next=%2F', owner)).status).toBe(400)
    expect((await ask('/api/site-entry?host=mine.example.com&next=%2F&state=short', owner)).status).toBe(400)
  })

  it('does not open a site for an API token, which is not a browser session', async () => {
    const { p, ask, asOwner } = await panel()
    const created = (await (await asOwner('POST', '/api/tokens', { name: 'ci', scopes: ['project:read'] })).json()) as {
      token?: string
    }
    if (!created.token) return
    const response = await p.app.request(entry('mine.example.com'), {
      headers: { authorization: `Bearer ${created.token}` },
    })
    expect(response.headers.get('location')).toContain('panel=denied')
    void ask
  })

  it('keeps a share to owners and admins even when the share names the project it was made from', async () => {
    const { ask, asOwner, p, seeded } = await panel()
    const created = (await (
      await asOwner('POST', '/api/users', {
        name: 'Grace',
        email: 'dev@example.test',
        password: PASSWORD,
        role: 'developer',
      })
    ).json()) as { id: string }
    await asOwner('PUT', `/api/users/${created.id}/projects`, { projects: [Number(seeded.ids.project)] })
    const developer = await signInAs(p.auth, 'dev@example.test', PASSWORD)
    const store = readProtectionStore(p.config.authStore)
    writeProtectionStore(
      p.config.authStore,
      setProtection(store, {
        entryPoints: ['websecure'],
        mode: 'protected',
        scope: 'share:b8e4',
        host: 'shared-alpha.example.com',
        label: 'a share of alpha',
        project: 'alpha',
        hash: '$portta$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    )
    expect((await ask(entry('shared-alpha.example.com'), developer)).headers.get('location')).toContain('panel=denied')
    expect(
      (
        await ask(entry('shared-alpha.example.com'), await signInAs(p.auth, 'owner@example.test', PASSWORD))
      ).headers.get('location'),
    ).toContain('/panel?token=')
  })

  it('does not sign anybody in on a panel that has no accounts', async () => {
    const seeded = await seededDatabase()
    const dir = mkdtempSync(join(tmpdir(), 'portta-site-entry-open-'))
    const authStore = join(dir, 'protections.json')
    writeProtectionStore(
      authStore,
      setProtection(emptyProtectionStore(), {
        entryPoints: ['websecure'],
        mode: 'protected',
        scope: 'host:mine.example.com',
        host: 'mine.example.com',
        label: 'mine',
        hash: '$portta$scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    )
    const { app } = makeApp({}, { authStore, dynamicDir: dir, authSecret: SECRET }, seeded.database)
    const response = await app.request(entry('mine.example.com'))
    expect(response.headers.get('location')).toContain('panel=off')
  })
})
