import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Environment } from 'portta-contracts'
import { environmentSettings, serviceSettings } from 'portta-db'
import { afterEach, describe, expect, it } from 'vitest'
import { GENERATED_FILES } from '../src/services/dynamic.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { databasePerFile, makeApp } from './helpers.ts'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'portta-overrides-'))
}

/**
 * A regular file, used as the parent of a path that must never be creatable.
 *
 * Deliberately not a read-only directory: `chmod` does not stop root, and CI
 * containers commonly run as root, so a permission-based version of this test
 * would silently pass without exercising the failure at all.
 */
function unwritableParent(): string {
  const file = join(scratch(), 'not-a-directory')
  writeFileSync(file, '')
  return file
}

const cleanup: string[] = []
afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    try {
      chmodSync(dir, 0o700)
    } catch {
      /* already writable */
    }
  }
})

const seededDatabase = databasePerFile()

async function app(dynamicDir = scratch(), options: { available?: boolean } = {}) {
  const seeded = await seededDatabase(options)
  return {
    ...makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { dynamicDir }, seeded.database),
    seeded,
    db: seeded.database,
    dynamicDir,
  }
}

/** What the database actually holds, rather than what a stand-in remembered. */
async function storedEnvironmentSettings(instance: Awaited<ReturnType<typeof app>>) {
  return instance.seeded.db.select().from(environmentSettings)
}

async function storedServiceSetting(instance: Awaited<ReturnType<typeof app>>, service: string, key: string) {
  const rows = await instance.seeded.db.select().from(serviceSettings)
  return rows.find((row) => row.service === service && row.key === key)?.value
}

async function put(instance: Awaited<ReturnType<typeof app>>, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('project overrides', () => {
  it('stores presentation without writing anything about routing', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/settings', {
      displayName: 'Awesome Thing',
      pinned: true,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ displayName: 'Awesome Thing', pinned: true })
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('clears a value when it is sent as null', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/settings', { description: 'temporary' })
    const response = await put(instance, '/api/environments/alpha/settings', { description: null })
    expect(await response.json()).toEqual({})
  })

  // The catalogue is closed, and a key outside it is the caller's mistake. A
  // 500 here -- an unmapped ZodError -- would tell an agent to retry something
  // that will never succeed.
  it('refuses a key outside the closed catalogue, as a client error', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/settings', { arbitrarySql: 'DROP' })
    expect(response.status).toBe(400)
    expect((await response.json()).hint).toContain('documented schema')
  })

  it('404s a project that is not running before touching the database', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/ghost/settings', { pinned: true })
    expect(response.status).toBe(404)
    expect(await storedEnvironmentSettings(instance)).toHaveLength(0)
  })

  it('answers 503 with a hint when persistence is down', async () => {
    const instance = await app(scratch(), { available: false })
    const response = await instance.app.request('/api/environments/alpha/settings')
    expect(response.status).toBe(503)
    expect((await response.json()).hint).toContain('Docker-backed pages remain available')
  })
})

describe('a hostname alias', () => {
  it('is served by Traefik through one generated file', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.host).toBe('shop.localhost')
    // Additive: the project's own hostname is still in the answer.
    expect(body.derivedHosts).toContain('alpha-web.localhost')

    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('Host(`shop.localhost`)')
    expect(written).toContain('http://alpha-web-1:80')
  })

  it('targets the container name, never the Compose service alias', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/services/api/alias', { alias: 'shop-api' })
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('http://alpha-api-1:3000')
  })

  it('refuses a hostname a running container already claims', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/services/web/alias', {
      alias: 'alpha-web.localhost',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('already the hostname')
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('refuses a hostname another alias already took', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })
    const response = await put(instance, '/api/environments/alpha/services/api/alias', { alias: 'shop' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('already an alias')
  })

  it('refuses a hostname outside the domains this gateway serves', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/services/web/alias', {
      alias: 'shop.example.com',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('outside the domains')
  })

  it('refuses a datastore, which is not reached with an HTTP router', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/services/postgres/alias', { alias: 'db' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('postgres service')
  })

  it('refuses a service the gateway does not route', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/services/redis/alias', { alias: 'cache' })
    expect(response.status).toBe(400)
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('refuses a value YAML quoting would not accept', async () => {
    const instance = await app()
    const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'sh"op' })
    expect(response.status).toBe(400)
  })

  it('rolls the row back when the file cannot be written', async () => {
    // A directory that cannot exist, for reasons no privilege overrides: its
    // parent is a regular file, so creating it fails ENOTDIR for root as well.
    //
    // Not a path inside procfs, which looks equivalent and is not: macOS has
    // no such filesystem, so the write would fail immediately and the test
    // pass. On Linux `mkdirSync(..., { recursive: true })` there never
    // returns — a synchronous spin no test timeout can interrupt, because
    // timeouts are async: such a line would hang the whole panel suite on every
    // Linux CI run while passing locally. The security checks refuse such a
    // path outright.
    const instance = await app(join(unwritableParent(), 'cannot-be-a-directory'))
    const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await storedServiceSetting(instance, 'web', 'alias')).toBeUndefined()
  })

  it('removes its router from the generated file when cleared', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })

    const response = await instance.app.request('/api/environments/alpha/services/web/alias', {
      method: 'DELETE',
      body: '{}',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).removed).toBe('shop.localhost')

    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).not.toContain('shop.localhost')
    expect(await storedServiceSetting(instance, 'web', 'alias')).toBeUndefined()
  })

  it('shows the alias on the service without touching its derived URLs', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })

    const project = (await (await instance.app.request('/api/environments/alpha')).json()) as Environment
    const web = project.services.find((service) => service.service === 'web')!
    expect(web.overrides?.alias).toBe('shop.localhost')
    expect(web.urls.map((url) => url.host)).toContain('alpha-web.localhost')
  })

  it('reports an alias whose container is gone', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })

    // The environment came back under a different namespace: the router now
    // points at a container name nothing answers to.
    const moved = makeApp({ containers: [...GATEWAY] }, { dynamicDir: instance.dynamicDir }, instance.db)
    const doctor = await moved.app.request('/api/gateway/doctor', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    const checks = (await doctor.json()).checks as { id: string; detail?: string; message?: string }[]
    expect(checks.some((check) => check.id === 'aliases-dangling')).toBe(true)
  })
})
