import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { permissionsOf } from 'portta-auth-core'
import type { Environment } from 'portta-contracts'
import { readProtectionStore, setProtection, verifyPassword, writeProtectionStore } from 'portta-core'
import { environmentSettings, serviceSettings } from 'portta-db'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  vi.restoreAllMocks()
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

async function put(instance: Pick<ReturnType<typeof makeApp>, 'app'>, path: string, body: unknown) {
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

describe('HTTP addresses for a secondary service', () => {
  it('accepts an existing declared HTTP target when Docker exposes a different port', async () => {
    const seeded = await seededDatabase()
    const dynamicDir = scratch()
    const instance = makeApp(
      {
        containers: PROJECT_A.map((entry) =>
          entry.id === 'a-web'
            ? {
                ...entry,
                exposed: [9000],
                labels: { ...entry.labels, 'traefik.http.services.alpha-web.loadbalancer.server.port': '8000' },
              }
            : entry,
        ),
      },
      { dynamicDir },
      seeded.database,
    )
    const response = await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'extra', port: 8000 })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ host: 'extra.localhost', port: 8000 })
    expect(readFileSync(join(dynamicDir, GENERATED_FILES.aliases), 'utf8')).toContain('http://alpha-web-1:8000')
  })

  async function mailpit(onGatewayNetwork = true, profile = 'local') {
    const seeded = await seededDatabase()
    const dynamicDir = scratch()
    return {
      ...makeApp(
        {
          containers: [
            ...GATEWAY,
            ...PROJECT_A,
            {
              id: 'a-mailpit',
              name: 'alpha-mailpit-1',
              image: 'axllent/mailpit:latest',
              networks: onGatewayNetwork ? ['portta', 'alpha_default'] : ['alpha_default'],
              exposed: [1025, 8025, 9001],
              labels: {
                'com.docker.compose.project': 'alpha',
                'com.docker.compose.service': 'mailpit',
                'traefik.enable': 'false',
              },
            },
          ],
        },
        { dynamicDir, profile, tlsEnabled: profile === 'remote-public' },
        seeded.database,
      ),
      dynamicDir,
    }
  }

  it('routes the chosen web port without changing SMTP or the primary application', async () => {
    const instance = await mailpit()
    const response = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'mail',
      port: 8025,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ host: 'mail.localhost', port: 8025 })
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('http://alpha-mailpit-1:8025')
    const project = (await (await instance.app.request('/api/environments/alpha')).json()) as Environment
    const service = project.services.find((entry) => entry.service === 'mailpit')!
    expect(service.kind).toBe('smtp')
    expect(service.urls).toContainEqual(expect.objectContaining({ host: 'mail.localhost', targetPort: 8025 }))
    expect(project.services.find((entry) => entry.service === 'web')!.urls[0]!.host).toBe('alpha--web.localhost')
  })

  it.each([1025, 3306, 65534])('refuses a TCP protocol or undiscovered target port %s', async (port) => {
    const instance = await mailpit()
    expect(
      (await put(instance, '/api/environments/alpha/services/mailpit/alias', { alias: 'mail', port })).status,
    ).toBe(400)
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('requires integration before publishing a secondary container hostname', async () => {
    const instance = await mailpit(false)
    const response = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'mail',
      port: 8025,
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('network')
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('keeps independent ports and concurrent hostnames of the same service', async () => {
    const instance = await mailpit()
    const responses = await Promise.all([
      put(instance, '/api/environments/alpha/services/mailpit/alias', { alias: 'mail', port: 8025 }),
      put(instance, '/api/environments/alpha/services/mailpit/alias', { alias: 'other-panel', port: 9001 }),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('http://alpha-mailpit-1:8025')
    expect(written).toContain('http://alpha-mailpit-1:9001')
  })

  it('protects an explicit public-host URL before publishing it and returns its credential once', async () => {
    const instance = await mailpit(true, 'remote-public')
    const response = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'mail',
      port: 8025,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user).toBe('reviewer')
    expect(body.password).toBeTruthy()
    const record = readProtectionStore(instance.config.authStore).protections.find((entry) => entry.host === body.host)!
    expect(record).toMatchObject({ mode: 'protected', project: 'alpha', service: 'mailpit' })
    expect(await verifyPassword(body.password, record.hash!)).toBe(true)
    expect(readFileSync(instance.config.authStore, 'utf8')).not.toContain(body.password)
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('middlewares: [portta-forward-auth]')
    expect(written).not.toContain(body.password)
    const secondResponse = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'other-mail',
      port: 9001,
    })
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json()
    const secondEpoch = readProtectionStore(instance.config.authStore).protections.find(
      (entry) => entry.host === second.host,
    )!.epoch
    expect(
      (
        await instance.app.request('/api/services/a-mailpit/exposure', {
          method: 'PUT',
          body: JSON.stringify({}),
          headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
        })
      ).status,
    ).toBe(400)
    const exposure = await instance.app.request('/api/services/a-mailpit/exposure', {
      method: 'PUT',
      body: JSON.stringify({ host: body.host }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(exposure.status).toBe(200)
    expect(
      readProtectionStore(instance.config.authStore).protections.find((entry) => entry.host === second.host)!.epoch,
    ).toBe(secondEpoch)
  })

  it('requires protection permission even when a caller tries to disable the public default', async () => {
    const instance = await mailpit(true, 'remote-public')
    const principal = await instance.principals.fromHeaders(new Headers())
    vi.spyOn(instance.principals, 'fromHeaders').mockResolvedValue({
      ...principal!,
      permissions: permissionsOf('developer'),
    })
    const response = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'mail',
      port: 8025,
      protect: false,
    })
    expect(response.status).toBe(403)
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
    expect(readProtectionStore(instance.config.authStore).protections).toEqual([])
    vi.restoreAllMocks()
    expect(
      (
        await put(instance, '/api/environments/alpha/services/mailpit/alias', {
          alias: 'mail',
          port: 8025,
          protect: false,
        })
      ).status,
    ).toBe(400)
  })

  it('checks project scope before validating the selected service port', async () => {
    const instance = await mailpit()
    const principal = await instance.principals.fromHeaders(new Headers())
    vi.spyOn(instance.principals, 'fromHeaders').mockResolvedValue({ ...principal!, scope: new Set() })
    const response = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'mail',
      port: 65534,
    })
    expect(response.status).toBe(403)
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('does not let a legacy request bypass protection permission when changing a public alias port', async () => {
    const seeded = await seededDatabase()
    const instance = makeApp(
      {
        containers: PROJECT_A.map((entry) =>
          entry.id === 'a-web'
            ? {
                ...entry,
                exposed: [80, 8080],
                labels: { ...entry.labels, 'traefik.http.services.alpha-web.loadbalancer.server.port': '80' },
              }
            : entry,
        ),
      },
      { dynamicDir: scratch(), profile: 'remote-public', tlsEnabled: true },
      seeded.database,
    )
    expect(
      (await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'extra', port: 8080 })).status,
    ).toBe(200)
    const principal = await instance.principals.fromHeaders(new Headers())
    vi.spyOn(instance.principals, 'fromHeaders').mockResolvedValue({
      ...principal!,
      permissions: permissionsOf('developer'),
    })
    expect((await put(instance, '/api/environments/alpha/services/web/alias', { alias: 'extra' })).status).toBe(403)
  })

  it('removes its new credential and database hostname if publishing the router fails', async () => {
    const instance = await mailpit(true, 'remote-public')
    instance.config.dynamicDir = join(unwritableParent(), 'cannot-be-a-directory')
    const response = await put(instance, '/api/environments/alpha/services/mailpit/alias', {
      alias: 'mail',
      port: 8025,
    })
    expect(response.status).toBe(500)
    expect(readProtectionStore(instance.config.authStore).protections).toEqual([])
    expect((await instance.db.settings.listAllService()).some((entry) => entry.key === 'aliases')).toBe(false)
  })
})
