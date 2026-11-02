import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { permissionsOf } from 'portta-auth-core'
import { readProtectionStore, verifyPassword } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { del, makeApp, post } from './helpers.ts'

function panel() {
  const dir = mkdtempSync(join(tmpdir(), 'portta-exposure-'))
  const authStore = join(dir, 'protections.json')
  const instance = makeApp(
    { containers: [...GATEWAY, ...PROJECT_A] },
    { authStore, dynamicDir: dir, profile: 'remote-public', tlsEnabled: true },
  )
  return { ...instance, authStore, dir }
}

async function put(app: ReturnType<typeof panel>['app'], path: string, body: unknown = {}) {
  return app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('who may open a service, from the panel', () => {
  it('is a permission only owner and admin hold', () => {
    expect(permissionsOf('owner').has('service:protect')).toBe(true)
    expect(permissionsOf('admin').has('service:protect')).toBe(true)
    expect(permissionsOf('developer').has('service:protect')).toBe(false)
    expect(permissionsOf('viewer').has('service:protect')).toBe(false)
  })

  it('shows the password once, stores a hash, and never returns the hash', async () => {
    const { app, authStore } = panel()
    const response = await put(app, '/api/services/a-web/exposure')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { entry: { host: string; mode: string }; password: string }
    expect(body.entry.mode).toBe('protected')
    expect(body.password).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('"hash"')

    const stored = readProtectionStore(authStore).protections[0]!
    expect(stored.hash).not.toBe(body.password)
    expect(await verifyPassword(body.password, stored.hash!)).toBe(true)
    expect(readFileSync(authStore, 'utf8')).not.toContain(body.password)

    const listed = await (await app.request('/api/exposure')).json()
    expect(listed.enforced).toBe(true)
    expect(JSON.stringify(listed)).not.toMatch(/"(hash|password)"/)
    expect(listed.entries).toHaveLength(1)
  })

  it('replaces the password when asked again, and the old one stops working', async () => {
    const { app, authStore } = panel()
    const first = (await (await put(app, '/api/services/a-web/exposure')).json()) as { password: string }
    const second = (await (await put(app, '/api/services/a-web/exposure')).json()) as { password: string }
    expect(second.password).not.toBe(first.password)
    const stored = readProtectionStore(authStore).protections[0]!
    expect(await verifyPassword(first.password, stored.hash!)).toBe(false)
    expect(await verifyPassword(second.password, stored.hash!)).toBe(true)
  })

  it('opens a host with no credential, and removes the decision', async () => {
    const { app, authStore } = panel()
    const opened = await post(app, '/api/services/a-web/exposure/open')
    expect(opened.status).toBe(200)
    expect(readProtectionStore(authStore).protections[0]).toMatchObject({ mode: 'public' })
    expect(readProtectionStore(authStore).protections[0]).not.toHaveProperty('hash')
    expect((await del(app, '/api/services/a-web/exposure')).status).toBe(200)
    expect(readProtectionStore(authStore).protections).toEqual([])
  })

  it('refuses to remove a decision that does not exist, and an unknown service', async () => {
    const { app } = panel()
    expect((await del(app, '/api/services/a-web/exposure')).status).toBe(400)
    expect((await put(app, '/api/services/nope/exposure')).status).toBe(404)
  })

  it('leaves temporary shares out of the exposure list', async () => {
    const { app } = panel()
    await put(app, '/api/services/a-web/exposure')
    const entries = (await (await app.request('/api/exposure')).json()).entries as Array<{ host: string }>
    expect(entries.every((entry) => !entry.host.endsWith('-share.localhost'))).toBe(true)
  })

  it('refuses a password over plain HTTP on a remote profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-exposure-'))
    const { app } = makeApp(
      { containers: [...GATEWAY, ...PROJECT_A] },
      { authStore: join(dir, 'p.json'), dynamicDir: dir, profile: 'remote-public', tlsEnabled: false },
    )
    expect((await put(app, '/api/services/a-web/exposure')).status).toBe(400)
  })

  it('does not take over a decision that belongs to another project', async () => {
    const { app, authStore } = panel()
    await put(app, '/api/services/a-web/exposure')
    const store = readProtectionStore(authStore)
    const foreign = store.protections.map((record) => ({ ...record, project: 'someone-else' }))
    const { writeProtectionStore } = await import('portta-core')
    writeProtectionStore(authStore, { ...store, protections: foreign })
    expect((await put(app, '/api/services/a-web/exposure')).status).toBe(400)
    expect((await post(app, '/api/services/a-web/exposure/open')).status).toBe(400)
    expect((await del(app, '/api/services/a-web/exposure')).status).toBe(400)
  })
})
