import { describe, expect, it, vi } from 'vitest'
import { LiveHub, translate } from '../src/realtime/hub.ts'
import { createSnapshotCache } from '../src/services/inventory.ts'
import { fakeDocker, testConfig } from './helpers.ts'

describe('translating Docker events', () => {
  it('forwards the container lifecycle', () => {
    const event = translate({
      Type: 'container',
      Action: 'start',
      Actor: { ID: 'abc', Attributes: { name: 'alpha-web-1', 'com.docker.compose.project': 'alpha' } },
      time: 1700,
    })
    expect(event).toMatchObject({ kind: 'container', action: 'start', name: 'alpha-web-1', project: 'alpha' })
  })

  it('recognises a health change', () => {
    const event = translate({
      Type: 'container',
      Action: 'health_status: unhealthy',
      Actor: { ID: 'abc', Attributes: { name: 'beta-web-1' } },
    })
    expect(event?.kind).toBe('health')
    expect(event?.action).toContain('unhealthy')
  })

  it('marks a bridge as its own kind, so the Access page can react', () => {
    const event = translate({
      Type: 'container',
      Action: 'destroy',
      Actor: {
        ID: 'abc',
        Attributes: { name: 'portta-access-alpha-postgres-x', 'portta.component': 'access-bridge' },
      },
    })
    expect(event?.kind).toBe('bridge')
    expect(event?.ownership).toBe('standalone')
  })

  it('knows a gateway container when it sees one', () => {
    const event = translate({
      Type: 'container',
      Action: 'restart',
      Actor: { ID: 'abc', Attributes: { name: 'traefik', 'portta.managed': 'true' } },
    })
    expect(event?.ownership).toBe('gateway')
  })

  it('drops the noise nothing on screen depends on', () => {
    expect(translate({ Type: 'container', Action: 'exec_create: ls' })).toBeNull()
    expect(translate({ Type: 'image', Action: 'pull' })).toBeNull()
    expect(translate({ Type: 'volume', Action: 'create' })).toBeNull()
    expect(translate({})).toBeNull()
  })
})

describe('the live hub', () => {
  it('keeps going when one browser goes away mid-write', () => {
    const docker = fakeDocker({ containers: [] })
    const config = testConfig()
    const hub = new LiveHub(docker.client, createSnapshotCache(docker.client, config))
    const healthy = vi.fn()
    hub.subscribe(() => {
      throw new Error('socket closed')
    })
    hub.subscribe(healthy)

    expect(() =>
      hub.publish({
        kind: 'container',
        action: 'die',
        id: 'x',
        name: 'x',
        project: null,
        ownership: 'external',
        at: 1,
      }),
    ).not.toThrow()
    expect(healthy).toHaveBeenCalledOnce()
  })
})
