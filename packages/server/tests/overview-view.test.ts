import type { Environment, Project } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { emptyMetrics } from '../src/services/metrics.ts'
import { attentionFor, buildOverview, type OverviewInput, projectPulses } from '../src/services/overview-view.ts'

const NOW = 1_800_000_000_000

function environment(name: string, overrides: Partial<Environment> = {}): Environment {
  return {
    name,
    integrated: true,
    workingDir: null,
    operable: { ok: true, reason: null, workingDir: null, configFiles: [] },
    startable: { ok: true, reason: null, via: 'iteration' },
    namespace: null,
    group: null,
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

const project = {
  id: '1',
  slug: 'shop',
  name: 'Shop',
  description: 'The shop',
  archived: false,
  relativePath: 'shop',
  resolvedPath: '/srv/projects/shop',
  location: 'managed',
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
    metrics: emptyMetrics(),
    problems: [],
    gatewayUp: true,
    ...overrides,
  }
}

describe('the overview', () => {
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

  it('orders projects by name and puts archived ones last', () => {
    const archived = {
      ...project,
      slug: 'old',
      name: 'Old',
      archived: true,
      environments: [],
    } as unknown as Project
    const pulses = projectPulses(input({ projects: [archived, project] }))
    expect(pulses.map((p) => p.slug)).toEqual(['shop', 'old'])
    expect(pulses[1]?.health).toBe('idle')
  })
})

describe('the host verdict on the overview', () => {
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
