import { describe, expect, it } from 'vitest'
import { type ContainerRecord, routeHostnameProblem, routesFor } from './inventory.js'

const container: ContainerRecord = {
  id: '1',
  name: 'shop-web-1',
  image: 'nginx:1',
  state: 'running',
  ports: [],
  networks: ['portta'],
  labels: { 'traefik.enable': 'true', 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web' },
}

describe('routes without a hostname', () => {
  // The panel's public entrypoint carries `PathPrefix(`/`)` and is reached by
  // address, not by name. Deriving `portta-web.localhost` for it would list a
  // URL nothing answers on. See docs/development/adr/0021-panel-access-modes.md.
  it('a router with an explicit rule that names no host is not listed', () => {
    const routed: ContainerRecord = {
      ...container,
      name: 'portta-web-1',
      labels: {
        ...container.labels,
        'com.docker.compose.project': 'portta',
        'traefik.http.routers.portta-panel.rule': 'PathPrefix(`/`)',
      },
    }
    expect(routesFor([routed], 'localhost')).toEqual([])
  })
})

describe('routes read from labels', () => {
  it('rejects an invalid assigned hostname without losing the other routes', () => {
    const broken = { ...container, name: 'broken', labels: { ...container.labels, 'portta.hostname': 'go--web' } }
    expect(routeHostnameProblem(broken, 'localhost')).toContain('invalid hostname label')
    expect(routesFor([broken, container], 'localhost').map((route) => route.hostname)).toEqual(['shop--web.localhost'])
  })

  it('announces the canonical label assigned to a generated router', () => {
    const routed = {
      ...container,
      labels: { ...container.labels, 'portta.hostname': 'shop--web--preview-9' },
    }
    expect(routesFor([routed], 'localhost')[0]).toMatchObject({
      hostname: 'shop--web--preview-9.localhost',
      url: 'http://shop--web--preview-9.localhost',
    })
  })

  it('lets an explicit Host() rule win, reads the backend port, and leaves out a TCP-only database', () => {
    const probe: ContainerRecord = {
      ...container,
      labels: {
        ...container.labels,
        'traefik.http.routers.probe.rule': 'Host(`explicit-name.test`)',
        'traefik.http.services.probe.loadbalancer.server.port': '9999',
      },
    }
    const database: ContainerRecord = {
      ...container,
      name: 'shop-postgres-1',
      labels: {
        ...container.labels,
        'com.docker.compose.service': 'postgres',
        'traefik.tcp.routers.shop-postgres.rule': 'HostSNI(`*`)',
      },
    }
    expect(routesFor([probe, database], 'localhost')).toEqual([
      expect.objectContaining({ hostname: 'explicit-name.test', port: '9999' }),
    ])
  })
})
