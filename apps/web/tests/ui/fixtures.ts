import type {
  ActivityEvent,
  ContainerSummary,
  DevelopmentOverview,
  DockerHost,
  Environment,
  EnvironmentOperable,
  EnvironmentStartable,
  ProjectPulse,
  Repository,
  RepositoryGit,
  Service,
  Session,
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
    repo: null,
    repoUrl: null,
    gitRoot: null,
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
    repo: null,
    repoUrl: null,
    gitRoot: null,
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
    urls: [{ url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' }],
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
        url: 'http://alpha-web.localhost',
        scope: 'local',
        usable: true,
        shareable: false,
        problem: null,
      },
      endpoints: [
        {
          provider: 'local',
          url: 'http://alpha-web.localhost',
          scope: 'local',
          usable: true,
          shareable: false,
          problem: null,
        },
        {
          provider: 'public',
          url: 'https://alpha-web.dev.example.test',
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

export function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 'r1',
    projectId: 'ws-1',
    name: 'api',
    role: 'api',
    provider: 'github',
    localPath: '/srv/projects/shop/api',
    relativePath: 'api',
    remoteUrl: 'git@github.com:acme/api.git',
    position: 0,
    scanKey: 'abcdef012345',
    scanPath: '/srv/projects/shop/api',
    git: {
      branch: 'main',
      detached: false,
      head: {
        sha: '9f2c1abfeed',
        shortSha: '9f2c1ab',
        subject: 'Add invoice totals',
        author: 'Ada',
        date: 1_700_000_000,
      },
      dirty: true,
      changed: 7,
      ahead: 3,
      behind: 0,
      base: 'origin/main',
      collectedAt: Math.floor(Date.now() / 1000) - 40,
      stale: false,
    },
    github: { slug: 'acme/api', htmlUrl: 'https://github.com/acme/api', role: null, position: 0 },
    environments: ['alpha'],
    instructionCount: 2,
    ...overrides,
  }
}

export function makeRepositoryGit(overrides: Partial<RepositoryGit> = {}): RepositoryGit {
  return {
    key: 'abcdef012345',
    collected: true,
    collectedAt: Math.floor(Date.now() / 1000) - 40,
    ageSeconds: 40,
    stale: false,
    staleAfterSeconds: 900,
    path: '/srv/projects/shop/api',
    name: 'api',
    git: {
      branch: 'main',
      detached: false,
      head: {
        sha: '9f2c1abfeed',
        shortSha: '9f2c1ab',
        subject: 'Add invoice totals',
        author: 'Ada',
        date: 1_700_000_000,
      },
      staged: 2,
      unstaged: 5,
      untracked: 0,
      unmerged: 0,
      dirty: true,
      upstream: 'origin/main',
      ahead: 3,
      behind: 0,
      remote: 'git@github.com:acme/api.git',
    },
    remote: {
      url: 'git@github.com:acme/api.git',
      host: 'github.com',
      slug: 'acme/api',
      kind: 'github',
      repoUrl: 'https://github.com/acme/api',
    },
    links: {
      repo: 'https://github.com/acme/api',
      commit: 'https://github.com/acme/api/commit/9f2c1abfeed',
      branch: 'https://github.com/acme/api/tree/main',
    },
    commits: [
      {
        sha: '9f2c1abfeed',
        shortSha: '9f2c1ab',
        subject: 'Add invoice totals',
        author: 'Ada',
        date: 1_700_000_000,
        url: 'https://github.com/acme/api/commit/9f2c1abfeed',
      },
      {
        sha: '1234567abcd',
        shortSha: '1234567',
        subject: 'Start invoices',
        author: 'Bob',
        date: 1_699_990_000,
        url: null,
      },
    ],
    instructions: [
      {
        path: 'AGENTS.md',
        audience: 'any',
        sizeBytes: 120,
        modifiedAt: 1_700_000_000,
        sha256: 'a',
        dirty: true,
        content: '# Rules\nNever prune.\n',
        truncated: false,
      },
      {
        path: '.cursor/rules/style.mdc',
        audience: 'cursor',
        sizeBytes: 70_000,
        modifiedAt: 1_700_000_000,
        sha256: 'b',
        dirty: false,
        content: null,
        truncated: true,
      },
    ],
    specifications: [],
    environments: ['alpha'],
    forge: {
      kind: 'github',
      collectedAt: 1_700_000_000,
      authenticated: true,
      reason: null,
      pulls: [
        {
          number: 61,
          title: 'Add invoice totals',
          state: 'OPEN',
          draft: false,
          reviewDecision: 'REVIEW_REQUIRED',
          checks: 'passing',
          url: 'https://github.com/acme/api/pull/61',
          headRefName: 'feat/61',
        },
      ],
    },
    reason: null,
    refreshCommand: './bin/portta repos scan --path /srv/projects/shop/api',
    ...overrides,
  }
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    project: 'produto',
    issueRef: 'github:acme/api#42',
    repository: { id: 'r1', name: 'api' },
    environment: 'produto',
    actor: 'claude',
    actorKind: 'agent',
    agent: 'claude-code',
    status: 'active',
    startedAt: Math.floor(Date.now() / 1000) - 720,
    lastActivityAt: Math.floor(Date.now() / 1000) - 60,
    endedAt: null,
    summary: null,
    headBefore: null,
    headAfter: null,
    commits: [{ sha: 'a'.repeat(40), subject: 'Add totals', at: 1_700_000_000 }],
    ...overrides,
  }
}

export function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'e1',
    at: 1_700_000_000,
    kind: 'issue.state',
    actor: 'claude',
    actorKind: 'agent',
    source: 'cli',
    summary: '#42 moved to in progress',
    project: 'produto',
    issueRef: 'github:acme/api#42',
    repositoryId: null,
    repositoryName: null,
    environment: null,
    sessionId: null,
    data: {},
    ...overrides,
  }
}

export function makePulse(overrides: Partial<ProjectPulse> = {}): ProjectPulse {
  return {
    slug: 'produto',
    name: 'Meu Produto',
    archived: false,
    activeSessions: 1,
    repositoryCount: 2,
    environmentCount: 1,
    runningEnvironments: 1,
    unhealthyServices: 0,
    health: 'ok',
    lastCommit: {
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      subject: 'Add totals',
      repository: 'api',
      date: 1_700_000_000,
    },
    lastActivityAt: 1_700_000_000,
    lastActivity: 'claude started #42',
    resources: { cpuUtilisation: 0.12, memoryUsedBytes: 400_000_000 },
    ...overrides,
  }
}

export function makeOverview(overrides: Partial<DevelopmentOverview> = {}): DevelopmentOverview {
  return {
    generatedAt: 1_700_000_000,
    work: { available: true, assigned: [], unavailableReason: null },
    sessions: [makeSession()],
    attention: [
      {
        kind: 'service-unhealthy',
        severity: 'fail',
        summary: 'produto/worker is unhealthy',
        project: 'produto',
        environment: 'produto',
        service: 'worker',
        href: '/environments/produto?service=worker',
      },
    ],
    projects: [makePulse()],
    code: {
      recentCommits: [
        {
          sha: 'a'.repeat(40),
          shortSha: 'aaaaaaa',
          subject: 'Add totals',
          author: 'Ada',
          date: 1_700_000_000,
          url: null,
          repository: { id: 'r1', name: 'api' },
          project: 'produto',
        },
      ],
      dirtyRepositories: [
        { id: 'r1', name: 'api', project: 'produto', branch: 'main', changed: 3, ahead: 1, behind: 0 },
      ],
    },
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
