import { describe, expect, it } from 'vitest'
import { gatewayAlreadyPublic, ungatedContainers } from './gate.ts'
import type { ContainerRecord } from './inventory.ts'

function container(name: string, labels: Record<string, string>, state = 'running'): ContainerRecord {
  return { id: name, name, image: 'x', state, labels, ports: [], networks: [] }
}

const GATED = {
  'traefik.enable': 'true',
  'traefik.http.routers.shop-web.rule': 'Host(`shop-web.example.com`)',
  'traefik.http.routers.shop-web.middlewares': 'portta-forward-auth@file',
}

describe('containers that would route with no login gate', () => {
  it('accepts a router that names the gate, and a project not routed at all', () => {
    expect(ungatedContainers([container('shop-web-1', GATED), container('shop-db-1', {})])).toEqual([])
  })

  it('names one with no router labels, because Traefik derives an open router for it', () => {
    expect(ungatedContainers([container('old-web-1', { 'traefik.enable': 'true' })])).toEqual(['old-web-1'])
  })

  it('names a router whose middlewares leave the gate out', () => {
    const labels = { ...GATED, 'traefik.http.routers.shop-web.middlewares': 'strip@docker' }
    expect(ungatedContainers([container('shop-web-1', labels)])).toEqual(['shop-web-1'])
  })

  it('names the container when only one of its routers is gated', () => {
    const labels = { ...GATED, 'traefik.http.routers.api.rule': 'Host(`api.example.com`)' }
    expect(ungatedContainers([container('shop-web-1', labels)])).toEqual(['shop-web-1'])
  })

  it('leaves out gateway components, stopped containers and datastores reached by TLS name', () => {
    expect(
      ungatedContainers([
        container('portta-web-1', { 'traefik.enable': 'true', 'portta.managed': 'true' }),
        container('stopped-1', { 'traefik.enable': 'true' }, 'exited'),
        container('db-1', { 'traefik.enable': 'true', 'traefik.tcp.routers.db.rule': 'HostSNI(`db.example.com`)' }),
      ]),
    ).toEqual([])
  })

  it('counts a restarting, paused or created container, and reads labels case-insensitively', () => {
    const open = { 'Traefik.Enable': 'TRUE' }
    expect(
      ungatedContainers([
        container('a-1', open, 'restarting'),
        container('b-1', open, 'paused'),
        container('c-1', open, 'created'),
        container('d-1', open, 'exited'),
      ]),
    ).toEqual(['a-1', 'b-1', 'c-1'])
    const labels = {
      'traefik.enable': 'true',
      'Traefik.HTTP.Routers.shop.Rule': 'Host(`x`)',
      'traefik.http.routers.shop.middlewares': 'Portta-Forward-Auth@file',
    }
    expect(ungatedContainers([container('shop-1', labels)])).toEqual([])
  })
})

describe('a gateway that already answers the network', () => {
  const traefik = (ip: string | null, state = 'running'): ContainerRecord => ({
    ...container('portta-traefik-1', { 'portta.managed': 'true', 'portta.component': 'traefik' }, state),
    ports: [{ ip: ip ?? '', privatePort: 443, publicPort: ip ? 443 : null, type: 'tcp' }],
  })

  it('is one that publishes on an address other than loopback', () => {
    expect(gatewayAlreadyPublic([traefik('0.0.0.0')])).toBe(true)
    expect(gatewayAlreadyPublic([traefik('203.0.113.10')])).toBe(true)
  })

  it('is not one bound to loopback, stopped, or publishing nothing', () => {
    expect(gatewayAlreadyPublic([traefik('127.0.0.1')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('::1')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('0.0.0.0', 'exited')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik(null)])).toBe(false)
    expect(gatewayAlreadyPublic([])).toBe(false)
  })
})
