// Which crawlers may read a project's addresses: the default blocks them all, a project can
// make an exception, and both are written where the gateway's login service reads them.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProtectionStore, writeProtectionStore } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { listAudit } from '../src/services/audit.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp, seededDatabase } from './helpers.ts'

const OPEN = { search: true, train: false, live: false, preview: true }
const NONE = { search: false, train: false, live: false, preview: false }

async function panel() {
  const seeded = await seededDatabase()
  await seeded.database.projects.setEnvironments(seeded.ids.project, ['alpha', 'alpha-issue182'])
  const dir = mkdtempSync(join(tmpdir(), 'portta-crawlers-'))
  const authStore = join(dir, 'protections.json')
  const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { authStore, dynamicDir: dir }, seeded.database)
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
  return { send, authStore, dir, seeded }
}

describe('crawler policy', () => {
  it('blocks every crawler until somebody says otherwise', async () => {
    const { send } = await panel()
    const response = await send('GET', '/api/crawlers')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ default: NONE, exceptions: [] })
  })

  it('writes the default where the login service reads it, and audits the change', async () => {
    const { send, authStore, dir, seeded } = await panel()
    expect((await send('PUT', '/api/crawlers', OPEN)).status).toBe(200)
    expect(readProtectionStore(authStore).crawlers).toEqual(OPEN)
    expect(readFileSync(join(dir, 'portta-auth.yaml'), 'utf8')).toContain('portta-forward-auth:')
    const entries = await listAudit(seeded.db, {})
    expect(entries.entries.some((entry) => entry.action === 'crawlers.changed')).toBe(true)
  })

  it('refuses a policy it does not understand', async () => {
    const { send } = await panel()
    expect((await send('PUT', '/api/crawlers', { search: 'yes' })).status).toBe(400)
    expect((await send('PUT', '/api/crawlers', { ...NONE, robots: true })).status).toBe(400)
  })

  it('keeps an exception for a project in every environment it adopted, and takes it back', async () => {
    const { send, authStore } = await panel()
    const set = await send('PUT', '/api/projects/produto/crawlers', { policy: OPEN })
    expect(set.status).toBe(200)
    expect(await set.json()).toMatchObject({
      own: OPEN,
      effective: OPEN,
      default: NONE,
      mixed: false,
      byEnvironment: { alpha: OPEN, 'alpha-issue182': OPEN },
    })
    expect(readProtectionStore(authStore).environments).toEqual({ alpha: OPEN, 'alpha-issue182': OPEN })
    expect(((await (await send('GET', '/api/crawlers')).json()) as { exceptions: unknown[] }).exceptions).toEqual([
      { project: 'produto', name: 'Produto', policy: OPEN, mixed: false },
    ])

    const cleared = await send('PUT', '/api/projects/produto/crawlers', { policy: null })
    expect(await cleared.json()).toMatchObject({ own: null, effective: NONE, mixed: false })
    expect(readProtectionStore(authStore).environments).toBeUndefined()
  })

  it('says so when the environments of a project disagree', async () => {
    const { send, authStore } = await panel()
    await send('PUT', '/api/projects/produto/crawlers', { policy: OPEN })
    const store = readProtectionStore(authStore)
    writeProtectionStore(authStore, { ...store, environments: { alpha: OPEN } })
    const state = await (await send('GET', '/api/projects/produto/crawlers')).json()
    expect(state).toMatchObject({ own: null, mixed: true })
  })

  it('answers 404 for a project that does not exist', async () => {
    const { send } = await panel()
    expect((await send('GET', '/api/projects/nobody/crawlers')).status).toBe(404)
    expect((await send('PUT', '/api/projects/nobody/crawlers', { policy: null })).status).toBe(404)
  })

  it('lists a project whose environments disagree instead of hiding it', async () => {
    const { send, authStore } = await panel()
    await send('PUT', '/api/projects/produto/crawlers', { policy: OPEN })
    writeProtectionStore(authStore, { ...readProtectionStore(authStore), environments: { alpha: OPEN } })
    const listed = (await (await send('GET', '/api/crawlers')).json()) as { exceptions: unknown[] }
    expect(listed.exceptions).toEqual([{ project: 'produto', name: 'Produto', policy: null, mixed: true }])
    const state = await (await send('GET', '/api/projects/produto/crawlers')).json()
    expect(state).toMatchObject({ byEnvironment: { alpha: OPEN, 'alpha-issue182': NONE } })
  })

  it('refuses an exception for a project that has no environment to apply it to, instead of saying it worked', async () => {
    const seeded = await seededDatabase()
    const dir = mkdtempSync(join(tmpdir(), 'portta-crawlers-'))
    const { app } = makeApp({}, { authStore: join(dir, 'protections.json'), dynamicDir: dir }, seeded.database)
    const response = await app.request('/api/projects/produto/crawlers', {
      method: 'PUT',
      body: JSON.stringify({ policy: OPEN }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(409)
  })

  it('does not hand an exception to the next project that adopts the environment', async () => {
    const { send, authStore } = await panel()
    await send('PUT', '/api/projects/produto/crawlers', { policy: OPEN })
    expect(readProtectionStore(authStore).environments).toEqual({ alpha: OPEN, 'alpha-issue182': OPEN })
    // The project lets go of one environment: the exception that was made for it goes too.
    const kept = await send('PUT', '/api/projects/produto/environments', { environments: ['alpha'] })
    expect(kept.status).toBe(200)
    expect(readProtectionStore(authStore).environments).toEqual({ alpha: OPEN })
  })

  it('forgets the exception of an environment nobody has when any decision is saved', async () => {
    const { send, authStore } = await panel()
    const store = readProtectionStore(authStore)
    writeProtectionStore(authStore, { ...store, environments: { ghost: OPEN } })
    await send('PUT', '/api/crawlers', NONE)
    expect(readProtectionStore(authStore).environments).toBeUndefined()
  })
})
