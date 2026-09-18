import type { AccessView } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { BRIDGE, EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A } from './fixtures.ts'
import { del, makeApp, post } from './helpers.ts'

const fast = { bridgeSettleMs: 0 }

describe('GET /api/access', () => {
  it('lists the TCP services a bridge could reach', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    const names = view.services.map((service) => `${service.project}/${service.service}`)

    expect(names).toContain('alpha/postgres')
    expect(names).toContain('alpha/redis')
    expect(names).toContain('external/postgres')
    // An HTTP service is reached by hostname, not by a bridge.
    expect(names).not.toContain('alpha/web')
  })

  it('shows an open bridge with a connection string that carries no password', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView

    expect(view.bridges).toHaveLength(1)
    expect(view.bridges[0]).toMatchObject({
      id: 'ab12cd',
      project: 'alpha',
      service: 'postgres',
      localPort: 55431,
      bindIp: '127.0.0.1',
      connectionString: 'postgresql://<user>@127.0.0.1:55431/<database>',
    })
    expect(view.bridges[0]?.connectionString).not.toMatch(/password|secret/i)
  })
})

describe('reaching a database by hostname', () => {
  const tcp = { ...fast, tcpEnabled: true, tcpPorts: { postgres: 5432, redis: 6379 } }

  const routedPostgres = {
    id: 'routed-pg',
    name: 'alpha-postgres-1',
    image: 'postgres:18.6-alpine',
    networks: ['alpha_default', 'portta-access'],
    exposed: [5432],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'postgres',
      'traefik.enable': 'true',
      'traefik.tcp.routers.alpha-postgres.rule': 'HostSNIRegexp(`^alpha-postgres\\..+$`)',
      'traefik.tcp.routers.alpha-postgres.tls': 'true',
    },
  }

  it('gives a routed datastore its address and a TLS connection string', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, routedPostgres] }, tcp)
    const view = (await (await app.request('/api/access')).json()) as AccessView

    const service = view.services.find((item) => item.service === 'postgres')
    expect(view.tcpRoutingEnabled).toBe(true)
    expect(service?.routing).toBe('starttls-sni')
    expect(service?.routed).toBe(true)
    expect(service?.gatewayAddress).toBe('alpha-postgres.localhost:5432')
    expect(service?.gatewayConnectionString).toBe(
      'postgresql://<user>@alpha-postgres.localhost:5432/<database>?sslmode=require',
    )
  })

  it('never puts a password in it', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, routedPostgres] }, tcp)
    const body = await (await app.request('/api/access')).text()
    expect(body).not.toMatch(/password|secret/i)
  })

  it('offers no address when the project has not opted in', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, tcp)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    const service = view.services.find((item) => item.service === 'postgres')
    expect(service?.routed).toBe(false)
    expect(service?.gatewayAddress).toBeNull()
  })

  it('offers none when the gateway is not publishing the entrypoints', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, routedPostgres] }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    expect(view.tcpRoutingEnabled).toBe(false)
    expect(view.services.find((item) => item.service === 'postgres')?.gatewayAddress).toBeNull()
  })

  it('tells Redis apart from PostgreSQL, and both from MySQL', async () => {
    const { app } = makeApp(
      {
        containers: [
          ...GATEWAY,
          {
            ...routedPostgres,
            id: 'r',
            name: 'alpha-redis-1',
            image: 'redis:8.10.1-alpine',
            exposed: [6379],
            labels: { ...routedPostgres.labels, 'com.docker.compose.service': 'redis' },
          },
          {
            id: 'm',
            name: 'alpha-mysql-1',
            image: 'mariadb:11.4',
            networks: ['alpha_default'],
            exposed: [3306],
            labels: { 'com.docker.compose.project': 'alpha', 'com.docker.compose.service': 'mysql' },
          },
        ],
      },
      tcp,
    )
    const view = (await (await app.request('/api/access')).json()) as AccessView
    const byService = Object.fromEntries(view.services.map((s) => [s.service, s]))

    expect(byService.redis?.routing).toBe('tls-sni')
    expect(byService.redis?.gatewayConnectionString).toContain('--sni alpha-redis.localhost')
    expect(byService.mysql?.routing).toBe('unsupported')
    expect(byService.mysql?.gatewayAddress).toBeNull()
  })
})

describe('POST /api/access', () => {
  it('creates the same bridge the CLI creates', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    const response = await post(app, '/api/access', { project: 'alpha', service: 'postgres' })
    expect(response.status).toBe(201)

    const spec = docker.created[0] as {
      name: string
      network: string
      targetPort: number
      bindIp: string
      labels: Record<string, string>
    }
    expect(spec.network).toBe('alpha_default')
    expect(spec.targetPort).toBe(5432)
    expect(spec.bindIp).toBe('127.0.0.1')
    expect(spec.name).toMatch(/^portta-access-alpha-postgres-[0-9a-f]{6}$/)
    expect(spec.labels['portta.managed']).toBe('true')
    expect(spec.labels['portta.component']).toBe('access-bridge')
    expect(spec.labels['portta.access.project']).toBe('alpha')
    expect(spec.labels['traefik.enable']).toBe('false')
  })

  it('reuses an open bridge instead of opening a second one', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const response = await post(app, '/api/access', { project: 'alpha', service: 'postgres' })
    expect(response.status).toBe(201)
    expect(docker.created).toHaveLength(0)
  })

  it('refuses a service that is not running', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    const response = await post(app, '/api/access', { project: 'alpha', service: 'nope' })
    expect(response.status).toBe(404)
  })

  it('refuses a service with no private network to join', async () => {
    const { app } = makeApp(
      {
        containers: [
          ...GATEWAY,
          {
            id: 'lonely',
            name: 'lonely',
            image: 'postgres:18.6-alpine',
            networks: ['portta'],
            exposed: [5432],
            labels: {
              'com.docker.compose.project': 'lonely',
              'com.docker.compose.service': 'postgres',
            },
          },
        ],
      },
      fast,
    )
    const response = await post(app, '/api/access', { project: 'lonely', service: 'postgres' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('private network') })
  })

  it('validates its input rather than trusting it', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    for (const body of [
      { project: '../etc', service: 'postgres' },
      { project: 'alpha', service: 'postgres', port: 0 },
      { project: 'alpha', service: 'postgres', port: 70000 },
      { project: 'alpha', service: 'postgres', localPort: 80 },
      { project: 'alpha', service: 'postgres', ttlSeconds: 5 },
      { project: 'alpha', service: 'postgres', extra: 'field' },
      {},
    ]) {
      expect((await post(app, '/api/access', body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('works on an external project too: it is just Docker', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...EXTERNAL] }, fast)
    expect((await post(app, '/api/access', { project: 'external', service: 'postgres' })).status).toBe(201)
    expect(docker.created).toHaveLength(1)
  })
})

describe('GET /api/access/services/:project/:service/connection', () => {
  const tcp = { ...fast, tcpEnabled: true, tcpPorts: { postgres: 5432, redis: 6379 } }
  const routed = {
    id: 'routed-pg',
    name: 'alpha-postgres-1',
    image: 'postgres:18.6-alpine',
    networks: ['alpha_default', 'portta-access'],
    exposed: [5432],
    env: ['POSTGRES_USER=shop', 'POSTGRES_PASSWORD=s3cret-value', 'POSTGRES_DB=storefront'],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'postgres',
      'traefik.enable': 'true',
      'traefik.tcp.routers.alpha-postgres.rule': 'HostSNIRegexp(`^alpha-postgres\\..+$`)',
      'traefik.tcp.routers.alpha-postgres.tls': 'true',
    },
  }

  it('returns a complete string and keeps the password off every other route', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, routed] }, tcp)
    const createdBefore = docker.created.length
    const connection = (await (await app.request('/api/access/services/alpha/postgres/connection')).json()) as {
      credentials: { password: string | null; discovered: boolean }
      endpoints: { url: string; connectionString: string }[]
    }
    expect(connection.credentials.discovered).toBe(true)
    expect(connection.credentials.password).toBe('s3cret-value')
    expect(connection.endpoints.some((entry) => entry.connectionString.includes('s3cret-value'))).toBe(true)
    expect(docker.created).toHaveLength(createdBefore)

    const listing = await (await app.request('/api/access')).text()
    expect(listing).not.toMatch(/s3cret-value/)
  })

  it('matches the hostname Traefik routes', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, routed] }, tcp)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    expect(view.services.find((item) => item.service === 'postgres')?.gatewayAddress).toBe(
      'alpha-postgres.localhost:5432',
    )
  })

  it('says so when the credential is not in the environment', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, { ...routed, env: [] }] }, tcp)
    const body = (await (await app.request('/api/access/services/alpha/postgres/connection')).json()) as {
      credentials: { discovered: boolean; reason: string | null; password: string | null }
    }
    expect(body.credentials.discovered).toBe(false)
    expect(body.credentials.password).toBeNull()
    expect(body.credentials.reason).toMatch(/POSTGRES_PASSWORD/)
  })

  it('404s for a service that is not here', async () => {
    const { app } = makeApp({ containers: [...GATEWAY] }, tcp)
    expect((await app.request('/api/access/services/alpha/postgres/connection')).status).toBe(404)
  })
})

describe('DELETE /api/access/:id', () => {
  it('closes a bridge without touching the service', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const response = await del(app, '/api/access/ab12cd')
    expect(response.status).toBe(200)
    expect(docker.removed).toEqual(['bridge-1'])
  })

  it('404s for an id that is not open', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    expect((await del(app, '/api/access/nothere')).status).toBe(404)
    expect(docker.removed).toEqual([])
  })
})
