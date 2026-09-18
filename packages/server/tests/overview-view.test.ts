import type { Environment, IssueSummary, Project, RepositoryGit, Session } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { emptyMetrics } from '../src/services/metrics.ts'
import { attentionFor, buildOverview, type OverviewInput, projectPulses } from '../src/services/overview-view.ts'

const NOW = 1_800_000_000_000

function issue(number: number, overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    ref: `github:acme/api#${number}`,
    provider: 'github',
    key: String(number),
    title: `Issue ${number}`,
    state: 'open',
    stateReason: null,
    labels: [],
    assignees: [],
    milestone: null,
    author: null,
    commentCount: 0,
    createdAt: 1,
    updatedAt: number,
    url: `https://github.com/acme/api/issues/${number}`,
    panelUrl: `/projects/shop/issues/github%3Aacme%2Fapi%23${number}`,
    ...overrides,
  }
}

function environment(name: string, overrides: Partial<Environment> = {}): Environment {
  return {
    name,
    integrated: true,
    workingDir: null,
    operable: { ok: true, reason: null, workingDir: null, configFiles: [] },
    startable: { ok: true, reason: null, via: 'iteration' },
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    services: [],
    serviceCount: 2,
    runningCount: 2,
    healthyCount: 2,
    unhealthyCount: 0,
    networks: [],
    urls: [{ url: 'http://x.localhost', host: 'x.localhost', scope: 'local', scheme: 'http' }],
    scopes: ['local'],
    startedAt: 1,
    uptimeSeconds: 10,
    ...overrides,
  } as Environment
}

const scan = {
  collected: true,
  git: {
    branch: 'main',
    dirty: true,
    staged: 1,
    unstaged: 2,
    untracked: 0,
    unmerged: 0,
    ahead: 3,
    behind: 0,
    remote: 'git@github.com:acme/api.git',
    head: { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'Add totals', author: 'Ada', date: 100 },
    detached: false,
    upstream: 'origin/main',
  },
  commits: [
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'Add totals', author: 'Ada', email: 'a@x', date: 100 },
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'Start', author: 'Ada', email: 'a@x', date: 50 },
  ],
  instructions: [
    {
      path: 'AGENTS.md',
      audience: 'any',
      sizeBytes: 10,
      modifiedAt: 1,
      sha256: 'x',
      dirty: false,
      content: '# rules',
      truncated: false,
    },
  ],
} as unknown as RepositoryGit

const project = {
  id: '1',
  slug: 'shop',
  name: 'Shop',
  description: 'The shop',
  archived: false,
  relativePath: 'shop',
  resolvedPath: '/srv/projects/shop',
  location: 'managed',
  repositories: [
    {
      id: '7',
      projectId: '1',
      name: 'api',
      role: 'api',
      provider: 'github',
      localPath: '/srv/projects/shop',
      relativePath: null,
      remoteUrl: null,
      position: 0,
      scanKey: 'abcdef012345',
      scanPath: '/srv/projects/shop',
      git: { branch: 'main' },
      github: null,
      environments: ['shop'],
      instructionCount: 1,
    },
  ],
  environments: [
    {
      environment: 'shop',
      source: 'path',
      running: true,
      serviceCount: 2,
      runningCount: 2,
      unhealthyCount: 0,
      urls: [],
    },
  ],
} as unknown as Project

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    now: NOW,
    projects: [project],
    environments: [environment('shop')],
    work: { available: true, assigned: [issue(1), issue(2)], unavailableReason: null },
    sessions: [
      {
        id: 's1',
        project: 'shop',
        issueRef: 'github:acme/api#1',
        repository: null,
        environment: 'shop',
        actor: 'claude',
        actorKind: 'agent',
        agent: 'claude-code',
        status: 'active',
        startedAt: 1,
        lastActivityAt: 2,
        endedAt: null,
        summary: null,
        headBefore: null,
        headAfter: null,
        commits: [],
      } satisfies Session,
    ],
    scans: new Map([['abcdef012345', scan]]),
    metrics: emptyMetrics(),
    problems: [],
    gatewayUp: true,
    lastActivity: new Map([['shop', { at: 5, summary: 'claude started #1' }]]),
    ...overrides,
  }
}

describe('the development dashboard', () => {
  it('raises attention for an unhealthy service, a degraded environment and a failing diagnostic, worst first', () => {
    const unhealthy = environment('shop', {
      runningCount: 1,
      unhealthyCount: 1,
      services: [{ service: 'worker', name: 'shop-worker-1', state: 'running', health: 'unhealthy' } as never],
    })
    const items = attentionFor(
      input({
        environments: [unhealthy],
        problems: [{ id: 'x', status: 'fail', title: 'Traefik is down' } as never],
      }),
    )
    expect(items.map((item) => item.kind)).toEqual(['service-unhealthy', 'diagnostic', 'environment-degraded'])
    expect(items[0]?.href).toContain('service=worker')
  })

  it('does not call an environment degraded because a one-shot completed', () => {
    const withMigration = environment('shop', { serviceCount: 3, runningCount: 2, completedCount: 1 })
    expect(attentionFor(input({ environments: [withMigration] })).map((item) => item.kind)).toEqual([])
    expect(projectPulses(input({ environments: [withMigration] }))[0]?.health).toBe('ok')

    const stillDown = environment('shop', { serviceCount: 4, runningCount: 2, completedCount: 1 })
    expect(attentionFor(input({ environments: [stillDown] })).map((item) => item.kind)).toEqual([
      'environment-degraded',
    ])
    expect(projectPulses(input({ environments: [stillDown] }))[0]?.health).toBe('partial')
  })

  it('orders projects by recent activity and puts archived ones last', () => {
    const archived = {
      ...project,
      slug: 'old',
      name: 'Old',
      archived: true,
      repositories: [],
      environments: [],
    } as unknown as Project
    const pulses = projectPulses(input({ projects: [archived, project] }))
    expect(pulses.map((p) => p.slug)).toEqual(['shop', 'old'])
    expect(pulses[1]?.health).toBe('idle')
  })
})

describe('the host verdict on the dashboard', () => {
  function measured(host: Partial<NonNullable<ReturnType<typeof emptyMetrics>['host']>>) {
    const metrics = emptyMetrics()
    metrics.stale = false
    metrics.collectorActive = true
    metrics.collectedAt = Math.floor(NOW / 1000)
    metrics.ageSeconds = 0
    metrics.host = {
      hostname: 'lab',
      manufacturer: null,
      model: null,
      productName: null,
      kind: null,
      architecture: 'arm64',
      virtual: false,
      platform: 'darwin',
      distro: 'macOS',
      version: null,
      release: null,
      kernel: null,
      uptimeSeconds: 100,
      cpu: { manufacturer: null, brand: 'M3', physicalCores: 8, logicalCores: 8, speed: null, speedMax: null },
      memoryTotalBytes: 100,
      memoryUsedBytes: 10,
      memoryAvailableBytes: 90,
      memoryUsedPercent: 0.1,
      swapTotalBytes: null,
      swapUsedBytes: null,
      cpuUtilisation: 0.1,
      cpuIdle: 0.9,
      load: null,
      storage: null,
      gpu: [],
      temperatureCelsius: null,
      battery: null,
      ...host,
    }
    return metrics
  }

  it('carries the verdict, so the panel does not compute one of its own', () => {
    const overview = buildOverview(input({ metrics: measured({ memoryUsedPercent: 0.95 }) }))
    expect(overview.resources.host?.pressure.level).toBe('pressured')
    expect(overview.resources.host?.pressure.measured).toBe(true)
  })

  it('raises a host under pressure as something to act on', () => {
    // The thresholds are ratios; the version this replaced compared them
    // against percentages, so this item could never appear.
    const items = attentionFor(input({ metrics: measured({ memoryUsedPercent: 0.95 }) }))
    const pressure = items.find((item) => item.kind === 'host-pressure')
    expect(pressure?.summary).toContain('RAM 95%')
  })

  it('says nothing about a host with room', () => {
    const items = attentionFor(input({ metrics: measured({}) }))
    expect(items.some((item) => item.kind === 'host-pressure')).toBe(false)
  })

  it('refuses to judge a host it has not measured', () => {
    const overview = buildOverview(input())
    expect(overview.resources.host).toBeNull()
    expect(attentionFor(input()).some((item) => item.kind === 'host-pressure')).toBe(false)
  })
})
