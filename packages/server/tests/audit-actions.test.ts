// One line per action.
//
// The audit vocabulary is a closed list of what the panel records (ADR 0013). The risk it guards
// against is not a wrong line, it is a missing one: a service that changes
// something sensitive and never says so. So this suite is table-guided — the
// table is the vocabulary itself — and every action has to be accounted for,
// either by a case here or by the file that writes it.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { AUDIT_ACTIONS, type AuditAction } from 'portta-core'
import type { Db } from 'portta-db'
import { beforeAll, describe, expect, it } from 'vitest'
import { listAudit } from '../src/services/audit.ts'
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
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      host: 'localhost',
      'x-forwarded-for': '203.0.113.7',
      ...cookies[as],
    },
  })
}

/** The entries written since the last call, newest first. */
let seen = 0
async function since(): Promise<
  { action: string; resourceName: string | null; ipAddress: string | null; metadata: Record<string, unknown> }[]
> {
  const { entries } = await listAudit(db, { limit: 500 })
  const fresh = entries.slice(0, entries.length - seen)
  seen = entries.length
  return fresh
}

const actionsIn = (entries: { action: string }[]) => entries.map((entry) => entry.action)

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
  await since()
})

describe('the accounts', () => {
  it('records a creation, with the role and never the password', async () => {
    const created = await json(
      await send('POST', '/api/users', 'owner', {
        name: 'Grace',
        email: 'grace@example.test',
        password: PASSWORD,
        role: 'developer',
      }),
    )
    ids.grace = created.id
    const [entry] = await since()
    expect(entry?.action).toBe('user.created')
    expect(entry?.resourceName).toBe('grace@example.test')
    expect(entry?.metadata.role).toBe('developer')
    expect(JSON.stringify(entry)).not.toContain(PASSWORD)
  })

  it('records the address the change came from', async () => {
    await send('PATCH', `/api/users/${ids.grace}/role`, 'owner', { role: 'viewer' })
    const [entry] = await since()
    expect(entry?.action).toBe('user.role_changed')
    expect(entry?.ipAddress).toBe('203.0.113.7')
    expect(entry?.metadata).toMatchObject({ from: 'developer', to: 'viewer' })
  })

  it('records a password an administrator set, without the password', async () => {
    await send('PATCH', `/api/users/${ids.grace}/password`, 'owner', { password: 'another-long-password' })
    const [entry] = await since()
    expect(entry?.action).toBe('user.password_set')
    expect(JSON.stringify(entry)).not.toContain('another-long-password')
  })

  it('records a ban and the lifting of it', async () => {
    await send('PATCH', `/api/users/${ids.grace}/ban`, 'owner', { banned: true, reason: 'testing' })
    expect(actionsIn(await since())).toContain('user.banned')
    await send('PATCH', `/api/users/${ids.grace}/ban`, 'owner', { banned: false })
    expect(actionsIn(await since())).toContain('user.unbanned')
  })

  it('records sessions being ended for somebody', async () => {
    await send('DELETE', `/api/users/${ids.grace}/sessions`, 'owner')
    expect(actionsIn(await since())).toContain('user.sessions_revoked')
  })

  it('records one line per Project a membership changed', async () => {
    const projectId = Number(seeded.ids.project)
    await send('PUT', `/api/users/${ids.grace}/projects`, 'owner', { projects: [projectId] })
    expect(actionsIn(await since())).toEqual(['project_access.granted'])
    await send('PUT', `/api/users/${ids.grace}/projects`, 'owner', { projects: [] })
    expect(actionsIn(await since())).toEqual(['project_access.revoked'])
  })

  it('records a removal, keeping the email the id no longer resolves to', async () => {
    await send('DELETE', `/api/users/${ids.grace}`, 'owner')
    const [entry] = await since()
    expect(entry?.action).toBe('user.deleted')
    expect(entry?.resourceName).toBe('grace@example.test')
  })
})

describe('the tokens', () => {
  it('records a creation without the secret, and the revocation after it', async () => {
    const created = await json(await send('POST', '/api/auth/tokens', 'owner', { name: 'laptop' }))
    const [creation] = await since()
    expect(creation?.action).toBe('token.created')
    expect(creation?.resourceName).toBe('laptop')
    expect(JSON.stringify(creation)).not.toContain(created.token)

    await send('DELETE', `/api/auth/tokens/${created.credential.id}`, 'owner')
    expect(actionsIn(await since())).toContain('token.revoked')
  })
})

describe('the Projects', () => {
  it('records creation, update and removal', async () => {
    await send('POST', '/api/projects', 'owner', { slug: 'audited', name: 'Audited' })
    expect(actionsIn(await since())).toEqual(['project.created'])
    await send('PATCH', '/api/projects/audited', 'owner', { name: 'Audited again' })
    const [updated] = await since()
    expect(updated?.action).toBe('project.updated')
    expect(updated?.metadata.fields).toEqual(['name'])
    await send('DELETE', '/api/projects/audited', 'owner')
    expect(actionsIn(await since())).toEqual(['project.deleted'])
  })
})

describe('the settings', () => {
  it('records which keys changed, and never their values', async () => {
    // A panel whose `.env` is `/dev/null` — the harness default — is a panel
    // that cannot save, so this one gets a file of its own.
    const dir = mkdtempSync(join(tmpdir(), 'portta-audit-'))
    const envFile = join(dir, '.env')
    writeFileSync(envFile, 'PORTTA_LOG_LEVEL=INFO\n')
    const writable = makeProtectedApp(seeded.database, { envFile })
    const cookie = await signInAs(writable.auth, 'owner@example.test', PASSWORD)
    const response = await writable.app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_LOG_LEVEL: 'DEBUG' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
    })
    expect(response.status).toBe(200)
    const [entry] = await since()
    expect(entry?.action).toBe('settings.changed')
    expect(entry?.metadata.changed).toEqual(['PORTTA_LOG_LEVEL'])
    expect(JSON.stringify(entry)).not.toContain('DEBUG')
    rmSync(dir, { recursive: true, force: true })
  })

  it('records which pending keys were discarded, and never their values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-audit-'))
    const envFile = join(dir, '.env')
    writeFileSync(envFile, 'PORTTA_LOG_LEVEL=DEBUG\n')
    const writable = makeProtectedApp(seeded.database, { envFile })
    const cookie = await signInAs(writable.auth, 'owner@example.test', PASSWORD)
    process.env.PORTTA_LOG_LEVEL = 'INFO'
    try {
      const response = await writable.app.request('/api/config/discard', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
      })
      expect(response.status).toBe(200)
      const [entry] = await since()
      expect(entry?.action).toBe('settings.discarded')
      expect(entry?.metadata.changed).toEqual(['PORTTA_LOG_LEVEL'])
      expect(JSON.stringify(entry)).not.toContain('DEBUG')
      expect(JSON.stringify(entry)).not.toContain('INFO')
    } finally {
      delete process.env.PORTTA_LOG_LEVEL
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records a change to what a local agent may do', async () => {
    await send('PUT', '/api/settings/agent-permissions', 'owner', { permissions: ['issue:read'] })
    const [entry] = await since()
    expect(entry?.action).toBe('settings.changed')
    expect(entry?.resourceName).toBe('agentPermissions')
  })
})

describe('signing in', () => {
  it('records a success, a failure and a sign-out', async () => {
    const wrong = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.test', password: 'not-the-password' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(wrong.status).not.toBe(200)
    const [failure] = await since()
    expect(failure?.action).toBe('auth.login_failed')
    expect(failure?.resourceName).toBe('owner@example.test')
    expect(JSON.stringify(failure)).not.toContain('not-the-password')

    // Over HTTP, not through `auth.api`: the line is written where Better Auth
    // is mounted, which is the only place that sees a request at all.
    const ok = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.test', password: PASSWORD }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(ok.status).toBe(200)
    expect(actionsIn(await since())).toContain('auth.login')

    await send('POST', '/api/auth/sign-out', 'owner', {})
    expect(actionsIn(await since())).toContain('auth.logout')
  })
})

// The suite above cannot reach every action: half of them need a Docker host,
// and the fake one these suites run against has no bridge to open and no
// gateway to apply. What can be checked without one is that nothing in the
// vocabulary is a word nobody writes — an action declared and never recorded is
// a promise the log does not keep.
describe('every action in the list is written by something', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url))

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return entry.name.endsWith('.ts') ? [readFileSync(path, 'utf8')] : []
    })
  }

  it('names each one somewhere in the panel source', () => {
    const code = sources(root).join('\n')
    const unwritten = (AUDIT_ACTIONS as readonly AuditAction[]).filter((action) => !code.includes(`'${action}'`))
    expect(unwritten).toEqual([])
  })
})
