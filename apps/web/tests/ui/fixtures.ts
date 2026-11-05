import type {
  ContainerSummary,
  DevelopmentOverview,
  DockerHost,
  Environment,
  EnvironmentOperable,
  EnvironmentStartable,
  ProjectPulse,
  Service,
} from 'portta-contracts'

export function makeStartable(ok = false): EnvironmentStartable {
  return ok
    ? { ok: true, reason: null, via: 'iteration' }
    : { ok: false, reason: 'every service is already running', via: null }
}

export function makeOperable(workingDir: string | null = '/srv/dev/alpha'): EnvironmentOperable {
  if (!workingDir) {
    return {
      ok: false,
      reason: 'this project has no Compose working directory label, so the runner cannot find it',
      workingDir: null,
      configFiles: [],
    }
  }
  return { ok: true, reason: null, workingDir, configFiles: [] }
}

import { resolveServiceTech } from 'portta-server'

/**
 * One environment as the list serves it. Counts follow the services given;
 * `presence: 'remembered'` empties them, the way the panel does for an
 * environment whose containers are gone.
 */
export function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  const remembered = overrides.presence === 'remembered'
  const services = remembered
    ? []
    : (overrides.services ?? [
        makeContainer({
          id: 'a-web',
          name: 'alpha-web-1',
          service: 'web',
          environment: 'alpha',
          ownership: 'integrated',
        }),
      ])
  const base: Environment = {
    name: 'alpha',
    presence: 'live',
    integrated: !remembered,
    workingDir: '/srv/dev/alpha',
    operable: makeOperable('/srv/dev/alpha'),
    startable: remembered ? { ok: true, reason: null, via: 'runner' } : makeStartable(),
    namespace: null,
    group: null,
    serviceCount: services.length,
    runningCount: services.filter((service) => service.state === 'running').length,
    healthyCount: services.filter((service) => service.health === 'healthy').length,
    unhealthyCount: services.filter((service) => service.health === 'unhealthy').length,
    services,
    networks: remembered ? [] : ['portta', 'alpha_default'],
    urls: [],
    scopes: [],
    startedAt: remembered ? null : 1_700_000_000,
    uptimeSeconds: remembered ? null : 3600,
  }
  return { ...base, ...overrides, services: overrides.services ?? services }
}

export function makeContainer(overrides: Partial<ContainerSummary> = {}): ContainerSummary {
  const image = overrides.image ?? 'nginx:1.31.4-alpine'
  const service = overrides.service ?? null
  const base: ContainerSummary = {
    id: 'c1',
    name: 'container-1',
    image,
    state: 'running',
    status: 'Up 3 hours',
    health: 'none',
    createdAt: 1_700_000_000,
    startedAt: 1_700_000_000,
    uptimeSeconds: 3600,
    ownership: 'external',
    gatewayComponent: null,
    environment: null,
    service,
    workingDir: null,
    namespace: null,
    group: null,
    networks: ['bridge'],
    onGatewayNetwork: false,
    traefikEnabled: false,
    ports: [],
    exposedPorts: [],
    kind: 'tcp',
    tech: resolveServiceTech({ image, service }),
    urls: [],
    mounts: [],
    labels: {},
    restartCount: 0,
    exitCode: null,
    oneOff: false,
    completed: false,
  }
  return {
    ...base,
    ...overrides,
    tech:
      overrides.tech ??
      resolveServiceTech({
        image: overrides.image ?? base.image,
        service: overrides.service ?? base.service,
        labels: overrides.labels ?? base.labels,
      }),
  }
}

export const CONTAINERS: ContainerSummary[] = [
  makeContainer({
    id: 'gw-traefik',
    name: 'portta-traefik-1',
    image: 'traefik:v3.7.12',
    ownership: 'gateway',
    gatewayComponent: 'traefik',
    health: 'healthy',
    networks: ['portta', 'portta-control'],
  }),
  makeContainer({
    id: 'a-web',
    name: 'alpha-web-1',
    ownership: 'integrated',
    environment: 'alpha',
    service: 'web',
    traefikEnabled: true,
    onGatewayNetwork: true,
    kind: 'http',
    health: 'healthy',
    networks: ['portta', 'alpha_default'],
    urls: [{ url: 'http://alpha--web.localhost', host: 'alpha--web.localhost', scope: 'local', scheme: 'http' }],
  }),
  makeContainer({
    id: 'ext-pg',
    name: 'external-postgres',
    image: 'postgres:18.6-alpine',
    ownership: 'external',
    environment: 'external',
    service: 'postgres',
    kind: 'postgres',
    networks: ['external_default'],
    exposedPorts: [5432],
    ports: [{ ip: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }],
    mounts: [
      {
        type: 'volume',
        name: 'external_pgdata',
        source: '/var/lib/docker/volumes/external_pgdata',
        destination: '/var/lib/postgresql/data',
        rw: true,
      },
    ],
  }),
  makeContainer({
    id: 'solo-old',
    name: 'some-old-container',
    image: 'busybox:1.37.0',
    ownership: 'standalone',
    state: 'exited',
    uptimeSeconds: null,
  }),
]

export const HOST: DockerHost = {
  engine: {
    version: '29.4.0',
    apiVersion: '1.51',
    os: 'Test Linux',
    arch: 'aarch64',
    cpus: 8,
    memoryBytes: 17_179_869_184,
    name: 'test-host',
  },
  containers: { total: 4, running: 3, paused: 0, stopped: 1 },
  byOwnership: { gateway: 1, integrated: 1, external: 1, standalone: 1 },
  networks: [
    {
      id: 'n1',
      name: 'portta',
      driver: 'bridge',
      scope: 'local',
      internal: false,
      containerCount: 2,
      managed: true,
      role: 'shared',
    },
  ],
  ports: [
    {
      hostPort: 3000,
      protocol: 'tcp',
      conflict: true,
      bindings: [
        { ip: '127.0.0.1', containerId: 'x', containerName: 'one', ownership: 'external', containerPort: 3000 },
        { ip: '0.0.0.0', containerId: 'y', containerName: 'two', ownership: 'standalone', containerPort: 3000 },
      ],
    },
    {
      hostPort: 5432,
      protocol: 'tcp',
      conflict: false,
      bindings: [
        {
          ip: '0.0.0.0',
          containerId: 'ext-pg',
          containerName: 'external-postgres',
          ownership: 'external',
          containerPort: 5432,
        },
      ],
    },
  ],
}

export function makeService(overrides: Partial<Service> = {}): Service {
  const base: Service = {
    name: 'web',
    environment: 'alpha',
    containerId: 'a-web',
    containerName: 'alpha-web-1',
    image: 'nginx:1.31.4-alpine',
    kind: 'http',
    tech: { id: 'nginx', label: 'nginx' },
    state: 'running',
    health: 'healthy',
    startedAt: 1_700_000_000,
    uptimeSeconds: 7200,
    restartCount: 0,
    exitCode: null,
    ports: [],
    exposedPorts: [80],
    networks: ['portta', 'alpha_default'],
    onGatewayNetwork: true,
    access: {
      kind: 'http',
      primary: {
        provider: 'local',
        url: 'http://alpha--web.localhost',
        scope: 'local',
        usable: true,
        shareable: false,
        problem: null,
      },
      endpoints: [
        {
          provider: 'local',
          url: 'http://alpha--web.localhost',
          scope: 'local',
          usable: true,
          shareable: false,
          problem: null,
        },
        {
          provider: 'public',
          url: 'https://alpha--web.dev.example.test',
          scope: 'public',
          usable: true,
          shareable: true,
          problem: null,
        },
      ],
      bridge: null,
      routed: true,
      problem: null,
    },
    resources: {
      cpuUtilisation: 0.08,
      memoryUsedBytes: 300 * 1024 * 1024,
      memoryLimitBytes: 1024 * 1024 * 1024,
      diskBytes: null,
      collectedAt: 1_700_000_000,
      stale: false,
    },
    actions: { start: false, stop: true, restart: true, logs: true, openAccess: false, share: true },
    hidden: false,
  }
  return { ...base, ...overrides }
}

export function makePulse(overrides: Partial<ProjectPulse> = {}): ProjectPulse {
  return {
    slug: 'produto',
    name: 'Meu Produto',
    archived: false,
    environmentCount: 1,
    runningEnvironments: 1,
    unhealthyServices: 0,
    health: 'ok',
    resources: { cpuUtilisation: 0.12, memoryUsedBytes: 400_000_000 },
    ...overrides,
  }
}

export function makeOverview(overrides: Partial<DevelopmentOverview> = {}): DevelopmentOverview {
  return {
    generatedAt: 1_700_000_000,
    attention: [
      {
        kind: 'service-unhealthy',
        severity: 'fail',
        summary: 'produto/worker is unhealthy',
        project: 'produto',
        environment: 'produto',
        service: 'worker',
        code: null,
        href: '/environments/produto?service=worker',
      },
    ],
    projects: [makePulse()],
    runtime: { environmentsRunning: 1, environmentsTotal: 2, servicesRunning: 4, servicesUnhealthy: 1, routedUrls: 2 },
    resources: {
      host: {
        cpuUtilisation: 0.71,
        memoryUsedPercent: 0.92,
        storageUsedPercent: 0.4,
        stale: false,
        collectorActive: true,
        pressure: {
          level: 'pressured',
          measured: true,
          reasons: [{ resource: 'memory', level: 'pressured', value: 0.92 }],
        },
      },
      topProjects: [
        {
          slug: 'produto',
          name: 'Meu Produto',
          environment: 'produto',
          cpuUtilisation: 0.38,
          memoryUsedBytes: 1_200_000_000,
        },
      ],
    },
    gateway: { up: true, problems: [] },
    ...overrides,
  }
}
