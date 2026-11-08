import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Environment } from 'portta-contracts'
import { readProtectionStore, setProtection, writeProtectionStore } from 'portta-core'
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

async function app(
  dynamicDir = scratch(),
  options: { available?: boolean } = {},
  config: Partial<Parameters<typeof makeApp>[1]> = {},
) {
  const seeded = await seededDatabase(options)
  return {
    ...makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { dynamicDir, ...config }, seeded.database),
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
    expect(body.derivedHosts).toContain('alpha--web.localhost')

    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('Host(`shop.localhost`)')
    expect(written).toContain('http://alpha-web-1:80')
  })

  it('passes through ForwardAuth on a public host, so an alias nobody decided about is closed', async () => {
    const instance = await app(scratch(), {}, { profile: 'remote-public', tlsEnabled: true })
    const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })
    expect(response.status).toBe(200)
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('middlewares: [portta-forward-auth]')
  })

  it('refuses a hostname whose access decision belongs to another service on a public host', async () => {
    const dir = scratch()
    const authStore = join(dir, 'protections.json')
    writeProtectionStore(
      authStore,
      setProtection(readProtectionStore(authStore), {
        scope: 'host:shop.localhost',
        host: 'shop.localhost',
        entryPoints: ['websecure'],
        mode: 'public',
        label: 'shop',
        project: 'other',
        service: 'web',
      }),
    )
    const instance = await app(dir, {}, { profile: 'remote-public', tlsEnabled: true, authStore })
    const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })
    expect(response.status).toBe(400)
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('keeps a suspended alias without a router when the panel writes another alias', async () => {
    const dir = scratch()
    const authStore = join(dir, 'protections.json')
    const instance = await app(dir, {}, { profile: 'remote-public', tlsEnabled: true, authStore })
    expect((await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop' })).status).toBe(200)
    // Somebody later decides shop.localhost for another project.
    writeProtectionStore(
      authStore,
      setProtection(readProtectionStore(authStore), {
        scope: 'host:shop.localhost',
        host: 'shop.localhost',
        entryPoints: ['websecure'],
        mode: 'public',
        label: 'shop',
        project: 'other',
        service: 'web',
      }),
    )
    const another = await put(instance, '/api/environments/alpha/services/api/alias', { alias: 'api' })
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    if (another.status === 200) expect(written).toContain('Host(`api.localhost`)')
    expect(written).not.toContain('Host(`shop.localhost`)')
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
      alias: 'alpha--web.localhost',
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

  it('routes a domain the user pointed at the gateway, and says what to create at the DNS provider', async () => {
    const instance = await app(scratch(), {}, { publicIp: '203.0.113.7' })
    const response = await put(instance, '/api/environments/alpha/services/web/alias', {
      alias: 'Shop.Example.com.br',
    })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.host).toBe('shop.example.com.br')
    expect(body.custom).toBe(true)
    expect(body.dns).toEqual({ type: 'A', name: 'shop.example.com.br', value: '203.0.113.7' })
    // The hostname the project derives keeps answering.
    expect(body.derivedHosts).toContain('alpha--web.localhost')
    expect(readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')).toContain(
      'Host(`shop.example.com.br`)',
    )
  })

  it('asks for HTTP-01 on a custom domain when the gateway issues its certificates over DNS-01', async () => {
    const instance = await app(scratch(), {}, { profile: 'remote', tlsEnabled: true, acmeChallenge: 'dns' })
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop.example.com.br' })
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'inside' })
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written.match(/^ +certResolver: "letsencrypthttp"/gm)).toHaveLength(1)
  })

  it('leaves the resolver alone when HTTP-01 is already how the gateway issues', async () => {
    const instance = await app(scratch(), {}, { profile: 'remote', tlsEnabled: true, acmeChallenge: 'http' })
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop.example.com.br' })
    expect(readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')).not.toContain('letsencrypthttp')
  })

  it('refuses a custom hostname that no certificate authority could issue for', async () => {
    const instance = await app()
    for (const alias of ['10.0.0.5', 'app.internal', 'app.local']) {
      const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias })
      expect(response.status).toBe(400)
    }
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('keeps several hostnames on one service, and removes one at a time', async () => {
    const instance = await app()
    await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'shop.example.com.br' })
    const second = await put(instance, '/api/environments/alpha/services/web/alias', {
      alias: 'www.shop.example.com.br',
    })
    expect((await second.json()).hosts).toEqual(['shop.example.com.br', 'www.shop.example.com.br'])

    const removal = await instance.app.request('/api/environments/alpha/services/web/alias?host=shop.example.com.br', {
      method: 'DELETE',
      headers: { origin: 'http://localhost', host: 'localhost' },
    })
    expect((await removal.json()).hosts).toEqual(['www.shop.example.com.br'])
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('Host(`www.shop.example.com.br`)')
    expect(written).not.toContain('Host(`shop.example.com.br`)')
  })

  it('answers 404 when the hostname to remove is not one of the service', async () => {
    const instance = await app()
    const response = await instance.app.request('/api/environments/alpha/services/web/alias?host=nope.example.com', {
      method: 'DELETE',
      headers: { origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(404)
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
    expect(web.overrides?.aliases).toEqual(['shop.localhost'])
    // The derived address stays, and the alias is listed beside it so every surface sees what answers.
    expect(web.urls.map((url) => url.host)).toEqual(['alpha--web.localhost', 'shop.localhost'])
    expect(web.urls.find((url) => url.host === 'shop.localhost')?.alias).toBe(true)
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
