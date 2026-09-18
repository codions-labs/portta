import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyProtectionStore, writeProtectionStore } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { diagnose, problemsOnly } from '../src/services/diagnostics.ts'
import { buildSnapshot } from '../src/services/inventory.ts'
import { EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A } from './fixtures.ts'
import { type FakeContainer, fakeDocker, testConfig } from './helpers.ts'

interface AuthFixtureOptions {
  secret?: boolean
  store?: boolean
  storeMode?: number
}

async function check(containers: FakeContainer[], overrides = {}, auth: AuthFixtureOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-diagnostics-'))
  const envFile = join(directory, '.env')
  const authStore = join(directory, 'auth/protections.json')
  writeFileSync(envFile, auth.secret === false ? '' : `PORTTA_AUTH_SECRET=${'ab'.repeat(32)}\n`, { mode: 0o600 })
  if (auth.store !== false) {
    writeProtectionStore(authStore, emptyProtectionStore())
    chmodSync(authStore, auth.storeMode ?? 0o600)
  }
  const config = testConfig({ envFile, authStore, ...overrides })
  const { client } = fakeDocker({ containers })
  const snapshot = await buildSnapshot(client, config)
  return diagnose(snapshot, config)
}

const find = (checks: Awaited<ReturnType<typeof check>>, id: string) => checks.find((entry) => entry.id === id)

describe('diagnostics', () => {
  it('passes on a healthy local gateway', async () => {
    const checks = await check([...GATEWAY, ...PROJECT_A])
    expect(find(checks, 'traefik')?.status).toBe('pass')
    expect(find(checks, 'socket-proxy')?.status).toBe('pass')
    expect(find(checks, 'network')?.status).toBe('pass')
    expect(find(checks, 'routes-off-network')?.status).toBe('pass')
    expect(find(checks, 'auth-secret')?.status).toBe('pass')
    expect(find(checks, 'auth-store')?.status).toBe('pass')
    expect(find(checks, 'auth-service')?.status).toBe('pass')
  })

  it('fails closed when authentication prerequisites are unsafe', async () => {
    const unhealthy = GATEWAY.map((container) =>
      container.labels?.['portta.component'] === 'auth' ? { ...container, health: 'unhealthy' as const } : container,
    )
    const checks = await check(unhealthy, {}, { secret: false, storeMode: 0o644 })
    expect(find(checks, 'auth-secret')?.status).toBe('fail')
    expect(find(checks, 'auth-store')?.status).toBe('fail')
    expect(find(checks, 'auth-service')?.status).toBe('fail')
  })

  it('reports a missing authentication store', async () => {
    const checks = await check(GATEWAY, {}, { store: false })
    expect(find(checks, 'auth-store')?.status).toBe('fail')
    expect(find(checks, 'auth-store')?.fix).toBe('portta up')
  })

  it('catches the most common adoption mistake: routed but off the network', async () => {
    const checks = await check([
      ...GATEWAY,
      {
        id: 'stray',
        name: 'stray-web-1',
        image: 'nginx:1.31.4-alpine',
        networks: ['stray_default'],
        labels: {
          'com.docker.compose.project': 'stray',
          'com.docker.compose.service': 'web',
          'traefik.enable': 'true',
        },
      },
    ])
    const problem = find(checks, 'routes-off-network')
    expect(problem?.status).toBe('fail')
    expect(problem?.detail).toContain('stray-web-1')
    expect(problem?.fix).toContain('portta')
  })

  it('catches two containers claiming the same hostname', async () => {
    const duplicate = {
      id: 'dupe',
      name: 'other-web-1',
      image: 'nginx:1.31.4-alpine',
      networks: ['portta'],
      labels: {
        'com.docker.compose.project': 'other',
        'com.docker.compose.service': 'web',
        'traefik.enable': 'true',
        'traefik.http.routers.other.rule': 'Host(`alpha-web.localhost`)',
      },
    }
    const checks = await check([...GATEWAY, ...PROJECT_A, duplicate])
    const problem = find(checks, 'hostname-collision')
    expect(problem?.status).toBe('fail')
    expect(problem?.detail).toContain('alpha-web.localhost')
  })

  it('never sees a `compose run` container collide with the service it ran as', async () => {
    const oneOff: FakeContainer = {
      id: 'a-web-run',
      name: 'alpha-web-run-3f2a1c',
      image: 'nginx:1.31.4-alpine',
      networks: ['portta', 'alpha_default'],
      labels: {
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'web',
        'com.docker.compose.oneoff': 'True',
        'traefik.enable': 'true',
      },
    }
    const checks = await check([...GATEWAY, ...PROJECT_A, oneOff])
    expect(find(checks, 'hostname-collision')?.status).toBe('pass')
  })

  it('warns when one environment runs from two directories', async () => {
    const elsewhere = {
      id: 'a-web-2',
      name: 'alpha-web-2',
      image: 'nginx:1.31.4-alpine',
      networks: ['portta', 'alpha_default'],
      labels: {
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'web',
        'com.docker.compose.project.working_dir': '/srv/projects/alpha-copy',
      },
    }
    const tagged = PROJECT_A.map((container) => ({
      ...container,
      labels: {
        ...container.labels,
        'com.docker.compose.project.working_dir': '/srv/projects/alpha',
      },
    }))
    const checks = await check([...GATEWAY, ...tagged, elsewhere])
    const problem = find(checks, 'split-working-dir')
    expect(problem?.status).toBe('warn')
    expect(problem?.title).toBe("Environment 'alpha' runs from two directories")
    expect(problem?.detail).toBe('/srv/projects/alpha, /srv/projects/alpha-copy')
    expect(problem?.fix).toContain('portta namespace')
    expect(problem?.params).toEqual({ name: 'alpha' })

    const clean = await check([...GATEWAY, ...tagged])
    expect(find(clean, 'split-working-dir')).toBeUndefined()
  })

  it('warns when something else holds the gateway ports', async () => {
    const checks = await check([
      ...GATEWAY,
      {
        id: 'squatter',
        name: 'other-proxy',
        image: 'nginx:1.31.4-alpine',
        networks: ['bridge'],
        published: [{ hostIp: '0.0.0.0', hostPort: 80, containerPort: 80 }],
      },
    ])
    const problem = find(checks, 'gateway-ports')
    expect(problem?.status).toBe('warn')
    expect(problem?.detail).toContain('other-proxy')
  })

  it('reports a missing shared network as a failure', async () => {
    const config = testConfig()
    const { client } = fakeDocker({
      containers: GATEWAY,
      networks: [{ Name: 'bridge' }],
    })
    const snapshot = await buildSnapshot(client, config)
    expect(find(diagnose(snapshot, config), 'network')?.status).toBe('fail')
  })

  it('flags an expired bridge so `access gc` gets run', async () => {
    const checks = await check([
      ...GATEWAY,
      {
        id: 'old-bridge',
        name: 'portta-access-alpha-postgres-old',
        image: 'alpine/socat:1.8.1.3',
        networks: ['alpha_default'],
        labels: {
          'portta.managed': 'true',
          'portta.component': 'access-bridge',
          'portta.access.id': 'old123',
          'portta.access.expires': '1000',
        },
      },
    ])
    expect(find(checks, 'stale-bridges')?.fix).toBe('portta access gc')
  })

  it('refuses to guess when Docker is unreachable', async () => {
    const config = testConfig()
    const client = {
      listContainers: () => Promise.reject(new Error('down')),
      listNetworks: () => Promise.reject(new Error('down')),
      info: () => Promise.reject(new Error('down')),
      version: () => Promise.reject(new Error('down')),
      inspect: () => Promise.reject(new Error('down')),
    } as any
    const snapshot = await buildSnapshot(client, config)
    const checks = diagnose(snapshot, config)
    expect(checks).toHaveLength(1)
    expect(checks[0]?.status).toBe('fail')
  })

  it('says so when the internet can reach the gateway', async () => {
    const checks = await check([...GATEWAY], {
      profile: 'remote-public',
      publicEnabled: true,
      publicDomain: 'dev.example.com',
    })
    expect(find(checks, 'public')?.status).toBe('warn')
  })

  it('does not invent a problem out of an external container', async () => {
    const checks = await check([...GATEWAY, ...EXTERNAL])
    expect(problemsOnly(checks)).toHaveLength(0)
  })

  it('checks the whole host, not only the gateway’s own projects', async () => {
    const checks = await check(FULL_HOST)
    expect(find(checks, 'unhealthy')?.detail).toContain('beta-web-1')
  })
})
