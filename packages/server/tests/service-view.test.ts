import type { ContainerSummary, MetricsCurrent } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { emptyMetrics } from '../src/services/metrics.ts'
import { accessFor, environmentServices, serviceView } from '../src/services/service-view.ts'
import { testConfig } from './helpers.ts'

function container(overrides: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    id: 'c1a2b3c4d5e6',
    name: 'shop-web-1',
    image: 'node:22',
    state: 'running',
    status: 'Up 3 hours',
    health: 'healthy',
    createdAt: 1,
    startedAt: 2,
    uptimeSeconds: 10800,
    ownership: 'integrated',
    gatewayComponent: null,
    environment: 'shop',
    service: 'web',
    workingDir: '/srv/projects/shop',
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    networks: ['portta', 'shop_default'],
    onGatewayNetwork: true,
    traefikEnabled: true,
    ports: [],
    exposedPorts: [3000],
    kind: 'http',
    tech: { id: 'node', label: 'Node' },
    urls: [
      { url: 'https://shop-web.dev.example.com', host: 'shop-web.dev.example.com', scope: 'public', scheme: 'https' },
      { url: 'http://shop-web.localhost', host: 'shop-web.localhost', scope: 'local', scheme: 'http' },
    ],
    mounts: [],
    labels: {},
    restartCount: 0,
    exitCode: null,
    oneOff: false,
    completed: false,
    ...overrides,
  }
}

function metrics(): MetricsCurrent {
  return {
    ...emptyMetrics(),
    collectedAt: 1_700_000_000,
    ageSeconds: 3,
    stale: false,
    collectorActive: true,
    projects: [
      {
        id: 'shop',
        name: 'shop',
        composeProject: 'shop',
        cpuUtilisation: 12,
        memoryUsedBytes: 400,
        containerCount: 2,
        networkRxBytes: 0,
        networkTxBytes: 0,
        containers: [
          {
            id: 'c1a2b3c4d5e6',
            name: 'shop-web-1',
            service: 'web',
            cpuUtilisation: 8,
            memoryUsedBytes: 300,
            memoryLimitBytes: 1000,
            memoryUsedPercent: 30,
            networkRxBytes: 0,
            networkTxBytes: 0,
            blockReadBytes: 0,
            blockWriteBytes: 0,
            pids: 3,
          },
          {
            id: 'ffff00001111',
            name: 'shop-postgres-1',
            service: 'postgres',
            cpuUtilisation: 4,
            memoryUsedBytes: 100,
            memoryLimitBytes: null,
            memoryUsedPercent: null,
            networkRxBytes: 0,
            networkTxBytes: 0,
            blockReadBytes: 0,
            blockWriteBytes: 0,
            pids: 5,
          },
        ],
      },
    ],
  } as MetricsCurrent
}

describe('a service row', () => {
  it('folds container, access, resources and actions into one row', () => {
    const view = serviceView(container(), testConfig(), metrics(), null)
    expect(view.name).toBe('web')
    expect(view.access.kind).toBe('http')
    expect(view.access.primary?.url).toBe('http://shop-web.localhost')
    expect(view.resources).toMatchObject({ cpuUtilisation: 8, memoryUsedBytes: 300, stale: false })
    expect(view.actions).toMatchObject({
      start: false,
      stop: true,
      restart: true,
      logs: true,
      openAccess: false,
      share: true,
    })
  })

  it('says why a routed service has no address, and hides endpoints of a stopped one', () => {
    const noUrl = accessFor(container({ urls: [] }), testConfig(), null)
    expect(noUrl.problem).toMatch(/no hostname/)
    const stopped = serviceView(container({ state: 'exited', urls: [] }), testConfig(), metrics(), null)
    expect(stopped.access.endpoints).toEqual([])
    expect(stopped.access.problem).toBeNull()
    expect(stopped.resources).toBeNull()
    expect(stopped.actions).toMatchObject({ start: true, stop: false, share: false })
  })

  it('gives a datastore a bridge to open, and no share', () => {
    const postgres = container({
      id: 'ffff00001111',
      name: 'shop-postgres-1',
      service: 'postgres',
      image: 'postgres:18',
      kind: 'postgres',
      tech: { id: 'postgres', label: 'PostgreSQL' },
      urls: [],
      traefikEnabled: false,
      onGatewayNetwork: false,
      exposedPorts: [5432],
    })
    const view = serviceView(postgres, testConfig(), metrics(), null)
    expect(view.access.kind).toBe('tcp')
    expect(view.access.endpoints.every((e) => e.provider !== 'internal')).toBe(true)
    expect(view.actions).toMatchObject({ openAccess: true, share: false })
    expect(view.resources?.cpuUtilisation).toBe(4)
  })

  it('read-only mode offers no action but logs', () => {
    const view = serviceView(container(), testConfig(), metrics(), null, { readOnly: true })
    expect(view.actions).toEqual({
      start: false,
      stop: false,
      restart: false,
      logs: true,
      openAccess: false,
      share: false,
    })
  })

  it('sums an environment and honours order and hidden overrides', () => {
    const postgres = container({
      id: 'ffff00001111',
      name: 'shop-postgres-1',
      service: 'postgres',
      image: 'postgres:18',
      kind: 'postgres',
      urls: [],
      exposedPorts: [5432],
    })
    const result = environmentServices(
      {
        name: 'shop',
        services: [container(), postgres],
        overrides: { serviceOrder: ['postgres'], hiddenServices: ['web'] },
      },
      testConfig(),
      metrics(),
      [],
    )
    expect(result.services.map((s) => `${s.name}${s.hidden ? '*' : ''}`)).toEqual(['postgres', 'web*'])
    expect(result.resources).toMatchObject({ cpuUtilisation: 12, memoryUsedBytes: 400, memoryLimitBytes: 1000 })
  })
})
