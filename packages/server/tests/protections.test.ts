import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { permissionsOf } from 'portta-auth-core'
import { parseAliases, readProtectionStore, renderAliases, verifyPassword } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { closeService, openService, protectService } from '../src/services/exposure.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { del, makeApp, post } from './helpers.ts'

const gatedProjects = PROJECT_A.map((container) => ({
  ...container,
  labels: {
    ...container.labels,
    ...(container.labels?.['traefik.enable'] === 'true'
      ? {
          [`traefik.http.routers.alpha-${container.labels['com.docker.compose.service']}.rule`]:
            container.labels['traefik.http.routers.alpha-api.rule'] ?? 'Host(`alpha--web.localhost`)',
          [`traefik.http.routers.alpha-${container.labels['com.docker.compose.service']}.middlewares`]:
            'portta-forward-auth@file',
        }
      : {}),
  },
}))

function panel() {
  const dir = mkdtempSync(join(tmpdir(), 'portta-exposure-'))
  const authStore = join(dir, 'protections.json')
  const instance = makeApp(
    { containers: [...GATEWAY, ...gatedProjects] },
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

  it('names a router open on names nobody can list, whichever project it belongs to', async () => {
    const loose = {
      ...PROJECT_A[0]!,
      id: 'loose',
      name: 'loose-1',
      labels: { 'traefik.enable': 'true', 'traefik.http.routers.w.rule': 'HostRegexp(`.+`)' },
    }
    const dir = mkdtempSync(join(tmpdir(), 'portta-exposure-'))
    const { app } = makeApp(
      { containers: [...GATEWAY, ...gatedProjects, loose] },
      { authStore: join(dir, 'protections.json'), dynamicDir: dir, profile: 'remote-public', tlsEnabled: true },
    )
    const listed = await (await app.request('/api/exposure')).json()
    expect(listed.openRouters).toEqual({ count: 1, names: ['loose-1'] })
  })

  it('has no open router to report while nothing routes around the gate', async () => {
    const { app } = panel()
    const listed = await (await app.request('/api/exposure')).json()
    expect(listed.openRouters).toEqual({ count: 0, names: [] })
  })

  it('can ask for the password alone, and keeps asking that way until told otherwise', async () => {
    const { app, authStore } = panel()
    const first = await put(app, '/api/services/a-web/exposure', { user: null })
    expect(first.status).toBe(200)
    expect(((await first.json()) as { entry: { user: string | null } }).entry.user).toBeNull()
    expect(readProtectionStore(authStore).protections[0]).not.toHaveProperty('user')

    await put(app, '/api/services/a-web/exposure')
    expect(readProtectionStore(authStore).protections[0]).not.toHaveProperty('user')

    await put(app, '/api/services/a-web/exposure', { user: 'reviewer' })
    expect(readProtectionStore(authStore).protections[0]?.user).toBe('reviewer')
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

  it.each(['local', 'remote-private', 'remote-public'])(
    'refuses credentials without router enforcement on %s',
    async (profile) => {
      const dir = mkdtempSync(join(tmpdir(), 'portta-exposure-'))
      const authStore = join(dir, 'protections.json')
      const { app } = makeApp(
        { containers: [...GATEWAY, ...PROJECT_A] },
        { authStore, dynamicDir: dir, profile, tlsEnabled: true },
      )
      const response = await put(app, '/api/services/a-web/exposure')
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('does not enforce')
      expect(readProtectionStore(authStore).protections).toEqual([])
    },
  )

  it('does not restore a closed service when another password finishes hashing', async () => {
    const { config, cache, authStore } = panel()
    const { containers } = await cache.get()
    const web = containers.find((container) => container.id === 'a-web')!
    const api = containers.find((container) => container.id === 'a-api')!
    openService(config, web, containers, true)
    const protection = protectService(config, api, { unscoped: true }, containers)
    closeService(config, web, true)
    await protection
    expect(readProtectionStore(authStore).protections.map((record) => record.service)).toEqual(['api'])
  })

  it('keeps concurrent protection changes and rechecks ownership after hashing', async () => {
    const { config, cache, authStore } = panel()
    const { containers } = await cache.get()
    const web = containers.find((container) => container.id === 'a-web')!
    const api = containers.find((container) => container.id === 'a-api')!
    await Promise.all([
      protectService(config, web, { unscoped: true }, containers),
      protectService(config, api, { unscoped: true }, containers),
    ])
    expect(readProtectionStore(authStore).protections).toHaveLength(2)

    closeService(config, web, true)
    const pending = protectService(config, web, { unscoped: true }, containers)
    const refused = expect(pending).rejects.toThrow('belongs to someone-else')
    openService(config, { ...web, environment: 'someone-else' }, [], true)
    await refused
    expect(readProtectionStore(authStore).protections.find((record) => record.service === 'web')?.project).toBe(
      'someone-else',
    )
  })

  it('suspends an alias before a newly decided service can authorize its old target', async () => {
    const { app, dir } = panel()
    const alias = {
      project: 'old-project',
      service: 'web',
      container: 'old-project-web-1',
      host: 'alpha--web.localhost',
      port: 80,
      entryPoint: 'websecure',
    }
    const file = join(dir, 'portta-aliases.yaml')
    writeFileSync(file, renderAliases([alias], true))
    expect((await post(app, '/api/services/a-web/exposure/open')).status).toBe(200)
    const rendered = readFileSync(file, 'utf8')
    expect(rendered).not.toContain('Host(`alpha--web.localhost`)')
    expect(parseAliases(rendered)).toEqual([alias])
    expect((await del(app, '/api/services/a-web/exposure')).status).toBe(200)
    expect(readFileSync(file, 'utf8')).toContain('Host(`alpha--web.localhost`)')
  })

  it('keeps a hostname closed when its alias routing state cannot be read', async () => {
    const { app, dir, authStore } = panel()
    mkdirSync(join(dir, 'portta-aliases.yaml'))
    expect((await post(app, '/api/services/a-web/exposure/open')).status).toBe(500)
    expect(readProtectionStore(authStore).protections).toEqual([])
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
