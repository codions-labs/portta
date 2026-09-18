import { describe, expect, it } from 'vitest'
import { buildSnapshot, collectPorts, urlsFor } from '../src/services/inventory.ts'
import { BRIDGE, EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A, STANDALONE } from './fixtures.ts'
import { type FakeContainer, fakeDocker, testConfig } from './helpers.ts'

const config = testConfig()

describe('classification', () => {
  it('separates the gateway, its projects and everything else', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    const owner = (id: string) => snapshot.containers.find((c) => c.id === id)?.ownership

    expect(owner('gw-traefik')).toBe('gateway')
    expect(owner('gw-proxy')).toBe('gateway')
    expect(owner('a-web')).toBe('integrated')
    expect(owner('ext-pg')).toBe('external')
    expect(owner('solo-mailpit')).toBe('standalone')
  })

  it('counts a datastore of an integrated project as part of that project', async () => {
    const { client } = fakeDocker({ containers: [...GATEWAY, ...PROJECT_A] })
    const snapshot = await buildSnapshot(client, config)
    // postgres is on alpha_default only: no gateway network, no Traefik label.
    expect(snapshot.containers.find((c) => c.id === 'a-postgres')?.ownership).toBe('integrated')
  })

  it('does not promote a Compose project that never joined the gateway', async () => {
    const { client } = fakeDocker({ containers: [...GATEWAY, ...EXTERNAL] })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.environments.find((p) => p.name === 'external')?.integrated).toBe(false)
  })

  it('survives a container that disappears between listing and inspecting', async () => {
    const { client } = fakeDocker({
      containers: FULL_HOST,
      failInspect: ['a-web'],
    })
    const snapshot = await buildSnapshot(client, config)
    const web = snapshot.containers.find((c) => c.id === 'a-web')
    expect(web).toBeDefined()
    expect(web?.name).toBe('alpha-web-1')
  })
})

describe('projects', () => {
  it('never lists a gateway container as somebody’s service', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.environments.map((p) => p.name)).not.toContain('portta')
  })

  it('is operable when Compose recorded a working directory', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    const alpha = snapshot.environments.find((p) => p.name === 'alpha')
    expect(alpha?.operable.ok).toBe(true)
    expect(alpha?.operable.workingDir).toBe('/srv/dev/alpha')
  })

  it('is not operable when the working-directory label is missing', async () => {
    const { client } = fakeDocker({
      containers: [
        ...GATEWAY,
        {
          id: 'lost-web',
          name: 'lost-web-1',
          image: 'nginx:1.31.4-alpine',
          labels: {
            'com.docker.compose.project': 'lost',
            'com.docker.compose.service': 'web',
            'traefik.enable': 'true',
          },
          networks: ['portta'],
        },
      ],
    })
    const snapshot = await buildSnapshot(client, config)
    const lost = snapshot.environments.find((p) => p.name === 'lost')
    expect(lost?.operable.ok).toBe(false)
    expect(lost?.operable.reason).toContain('working directory')
  })
})

describe('URLs', () => {
  it('derives the hostname the way Traefik’s default rule does', () => {
    const urls = urlsFor(
      {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'Base Empresarial',
        'com.docker.compose.service': 'web',
      },
      'whatever',
      config,
    )
    expect(urls[0]?.url).toBe('http://base-empresarial-web.localhost')
    expect(urls[0]?.scope).toBe('local')
  })

  it('lets an explicit Host() rule win, exactly like Traefik', () => {
    const urls = urlsFor(
      {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'api',
        'traefik.http.routers.alpha.rule': 'Host(`api.alpha.test`) || Host(`alt.alpha.test`)',
      },
      'alpha-api-1',
      config,
    )
    expect(urls.map((url) => url.host)).toEqual(['api.alpha.test', 'alt.alpha.test'])
  })

  it('gives no URL to a service that did not opt in', () => {
    expect(urlsFor({ 'com.docker.compose.project': 'alpha' }, 'x', config)).toEqual([])
  })

  it('gives no URL to a database routed by hostname, which has no browser address', () => {
    expect(
      urlsFor(
        {
          'traefik.enable': 'true',
          'com.docker.compose.project': 'alpha',
          'com.docker.compose.service': 'postgres',
          'traefik.tcp.routers.alpha-postgres.rule': 'HostSNIRegexp(`^alpha-postgres\\..+$`)',
        },
        'alpha-postgres-1',
        config,
      ),
    ).toEqual([])
  })

  it('calls a database routed by hostname a database, not an HTTP service', async () => {
    // traefik.enable is set on a TCP-routed datastore too, so keying the kind
    // off that label alone would label PostgreSQL `http` in the panel.
    const { client } = fakeDocker({
      containers: [
        {
          id: 'a-pg',
          name: 'alpha-postgres-1',
          image: 'postgres:18.6-alpine',
          networks: ['alpha_default', 'portta-access'],
          exposed: [5432],
          labels: {
            'com.docker.compose.project': 'alpha',
            'com.docker.compose.service': 'postgres',
            'traefik.enable': 'true',
            'traefik.tcp.routers.alpha-postgres.rule': 'HostSNIRegexp(`^alpha-postgres\\..+$`)',
          },
        },
      ],
    })
    const snapshot = await buildSnapshot(client, config)
    const pg = snapshot.containers.find((c) => c.id === 'a-pg')

    expect(pg?.kind).toBe('postgres')
    expect(pg?.urls).toEqual([])
    expect(pg?.traefikEnabled).toBe(true)
  })

  it('still gives one to a service that is routed over both', () => {
    const urls = urlsFor(
      {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'web',
        'traefik.tcp.routers.alpha-web.rule': 'HostSNI(`x`)',
        'traefik.http.routers.alpha-web.rule': 'Host(`alpha-web.test`)',
      },
      'alpha-web-1',
      config,
    )
    expect(urls.map((url) => url.host)).toEqual(['alpha-web.test'])
  })
})

describe('published ports', () => {
  it('flags a port claimed by two containers', () => {
    const usage = collectPorts([
      {
        id: 'one',
        name: 'one',
        state: 'running',
        ownership: 'external',
        ports: [
          {
            ip: '127.0.0.1',
            hostPort: 3000,
            containerPort: 3000,
            protocol: 'tcp',
          },
        ],
      },
      {
        id: 'two',
        name: 'two',
        state: 'running',
        ownership: 'standalone',
        ports: [
          {
            ip: '0.0.0.0',
            hostPort: 3000,
            containerPort: 3000,
            protocol: 'tcp',
          },
        ],
      },
    ] as any)
    expect(usage).toHaveLength(1)
    expect(usage[0]?.conflict).toBe(true)
    expect(usage[0]?.bindings).toHaveLength(2)
  })

  it('ignores a stopped container’s old mapping', async () => {
    const { client } = fakeDocker({ containers: [...STANDALONE] })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.ports.every((port) => port.hostPort !== 0)).toBe(true)
    expect(snapshot.containers.find((c) => c.id === 'solo-old')?.state).toBe('exited')
  })
})

describe('the snapshot cache', () => {
  it('serves one build to concurrent callers', async () => {
    const docker = fakeDocker({ containers: [...GATEWAY, BRIDGE] })
    const { createSnapshotCache } = await import('../src/services/inventory.ts')
    const cache = createSnapshotCache(docker.client, config, 1000)
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(docker.calls.filter((call) => call.method === 'listContainers')).toHaveLength(1)
  })
})

describe('the optional identity labels', () => {
  const declaring: FakeContainer[] = [
    {
      id: 'w-web',
      name: 'storefront-issue59-web-1',
      image: 'nginx:1.31.4-alpine',
      networks: ['portta'],
      labels: {
        'com.docker.compose.project': 'storefront-issue59',
        'com.docker.compose.service': 'web',
        'com.docker.compose.project.working_dir': '/srv/dev/storefront-issue59',
        'traefik.enable': 'true',
        'portta.project': 'storefront',
        'portta.repo': 'owner/storefront',
        'portta.git.root': '/srv/dev/storefront-issue59',
      },
    },
    {
      // The datastore declares nothing, which is the normal case.
      id: 'w-pg',
      name: 'storefront-issue59-postgres-1',
      image: 'postgres:18.6-alpine',
      networks: ['storefront_default'],
      labels: {
        'com.docker.compose.project': 'storefront-issue59',
        'com.docker.compose.service': 'postgres',
      },
    },
  ]

  it('reads them onto the container and up onto the project', async () => {
    const { client } = fakeDocker({ containers: declaring })
    const snapshot = await buildSnapshot(client, config)
    const project = snapshot.environments.find((item) => item.name === 'storefront-issue59')

    expect(project?.group).toBe('storefront')
    expect(project?.repo).toBe('owner/storefront')
    expect(project?.repoUrl).toBe('https://github.com/owner/storefront')
    expect(project?.gitRoot).toBe('/srv/dev/storefront-issue59')
  })

  it('takes them from whichever service declared them', async () => {
    const { client } = fakeDocker({ containers: declaring })
    const snapshot = await buildSnapshot(client, config)
    const postgres = snapshot.containers.find((item) => item.id === 'w-pg')
    // The container itself declared nothing, and says so.
    expect(postgres?.group).toBeNull()
    expect(snapshot.environments[0]?.group).toBe('storefront')
  })

  it('leaves a project that declares none exactly as it was', async () => {
    // The guarantee ADR 0010 makes, asserted rather than promised.
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    for (const project of snapshot.environments) {
      expect(project.group).toBeNull()
      expect(project.repo).toBeNull()
      expect(project.repoUrl).toBeNull()
      expect(project.gitRoot).toBeNull()
    }
    expect(snapshot.environments.find((item) => item.name === 'beta')?.namespace).toBe('beta-issue59')
  })

  it('derives no repository link from a label it cannot parse', async () => {
    const { client } = fakeDocker({
      containers: [
        {
          id: 'bad',
          name: 'x-web-1',
          image: 'nginx:1.31.4-alpine',
          networks: ['portta'],
          labels: {
            'com.docker.compose.project': 'x',
            'com.docker.compose.service': 'web',
            'traefik.enable': 'true',
            'portta.repo': 'not a remote at all',
          },
        },
      ],
    })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.environments[0]?.repo).toBe('not a remote at all')
    expect(snapshot.environments[0]?.repoUrl).toBeNull()
  })
})

describe('what is not a service', () => {
  const oneOff: FakeContainer = {
    id: 'a-web-run',
    name: 'alpha-web-run-3f2a1c',
    image: 'nginx:1.31.4-alpine',
    networks: ['portta', 'alpha_default'],
    exposed: [80],
    state: 'exited',
    exitCode: 0,
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'web',
      'com.docker.compose.oneoff': 'True',
      'traefik.enable': 'true',
    },
  }

  it('keeps a `compose run` container out of the environment’s services, counts and URLs', async () => {
    const { client } = fakeDocker({
      containers: [...GATEWAY, ...PROJECT_A, oneOff],
    })
    const snapshot = await buildSnapshot(client, config)
    const container = snapshot.containers.find((c) => c.id === 'a-web-run')
    expect(container?.oneOff).toBe(true)
    expect(container?.environment).toBe('alpha')
    expect(container?.urls).toEqual([])
    expect(container?.kind).not.toBe('http')

    const alpha = snapshot.environments.find((p) => p.name === 'alpha')
    expect(alpha?.services.map((s) => s.id)).not.toContain('a-web-run')
    expect(alpha?.serviceCount).toBe(4)
    expect(alpha?.urls.filter((url) => url.host === 'alpha-web.localhost')).toHaveLength(1)
  })

  it('calls a service that exited 0 with no restart policy completed, and counts it', async () => {
    const migrate: FakeContainer = {
      id: 'a-migrate',
      name: 'alpha-migrate-1',
      image: 'alpine:3.24.1',
      networks: ['alpha_default'],
      state: 'exited',
      exitCode: 0,
      labels: {
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'migrate',
      },
    }
    const crashed: FakeContainer = {
      ...migrate,
      id: 'a-crashed',
      name: 'alpha-crashed-1',
      exitCode: 1,
      labels: { ...migrate.labels, 'com.docker.compose.service': 'crashed' },
    }
    const restarts: FakeContainer = {
      ...migrate,
      id: 'a-restarts',
      name: 'alpha-restarts-1',
      restartPolicy: 'unless-stopped',
      labels: { ...migrate.labels, 'com.docker.compose.service': 'restarts' },
    }
    const { client } = fakeDocker({
      containers: [...GATEWAY, ...PROJECT_A, migrate, crashed, restarts],
    })
    const snapshot = await buildSnapshot(client, config)
    const completed = (id: string) => snapshot.containers.find((c) => c.id === id)?.completed
    expect(completed('a-migrate')).toBe(true)
    expect(completed('a-crashed')).toBe(false)
    expect(completed('a-restarts')).toBe(false)
    expect(completed('a-web')).toBe(false)

    const stoppedWeb: FakeContainer = {
      ...migrate,
      id: 'a-stopped-web',
      name: 'alpha-stopped-web-1',
      labels: { ...migrate.labels, 'com.docker.compose.service': 'web' },
    }
    const stoppedSnapshot = await buildSnapshot(fakeDocker({ containers: [...GATEWAY, stoppedWeb] }).client, config)
    expect(stoppedSnapshot.containers.find((container) => container.id === 'a-stopped-web')?.completed).toBe(false)

    const alpha = snapshot.environments.find((p) => p.name === 'alpha')
    expect(alpha?.serviceCount).toBe(7)
    expect(alpha?.runningCount).toBe(4)
    expect(alpha?.completedCount).toBe(1)
  })

  it('calls a container with no port a worker, not TCP', async () => {
    const worker: FakeContainer = {
      id: 'a-horizon',
      name: 'alpha-horizon-1',
      image: 'php:8.4-cli',
      networks: ['alpha_default'],
      // Inherited from the shared PHP image; it does not make Horizon a TCP
      // service because this process never listens on it.
      exposed: [8000],
      labels: {
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'horizon',
      },
    }
    const { client } = fakeDocker({
      containers: [...GATEWAY, ...PROJECT_A, worker],
    })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.containers.find((c) => c.id === 'a-horizon')?.kind).toBe('worker')
    // A port, even unpublished, keeps the honest fallback.
    expect(snapshot.containers.find((c) => c.id === 'a-postgres')?.kind).toBe('postgres')
    expect(snapshot.containers.find((c) => c.id === 'a-web')?.kind).toBe('http')
  })
})
