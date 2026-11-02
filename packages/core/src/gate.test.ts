import { describe, expect, it } from 'vitest'
import { hasForwardAuth } from './forward-auth.ts'
import { gatewayAlreadyPublic, openCatchAllContainers, ungatedContainers } from './gate.ts'
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
        container('db-1', {
          'traefik.enable': 'true',
          'traefik.tcp.routers.db.rule': 'HostSNI(`db.example.com`)',
          'traefik.tcp.routers.db.entrypoints': 'postgres',
        }),
      ]),
    ).toEqual([])
  })

  it.each(['web', 'websecure', 'postgres, WebSecure', ''])(
    'refuses a TCP router that can take public HTTP traffic (%s)',
    (entrypoints) => {
      const tcp = {
        'Traefik.Enable': 'true',
        'Traefik.TCP.Routers.bypass.Rule': 'HostSNI(`app.example.com`)',
        'Traefik.TCP.Routers.bypass.TLS.Passthrough': 'true',
        ...(entrypoints ? { 'Traefik.TCP.Routers.bypass.EntryPoints': entrypoints } : {}),
      }
      expect(ungatedContainers([container('bypass-1', tcp)])).toEqual(['bypass-1'])
      expect(ungatedContainers([container('bypass-1', { ...GATED, ...tcp })])).toEqual(['bypass-1'])
      expect(hasForwardAuth({ ...GATED, ...tcp })).toBe(false)
    },
  )

  it('only reports enforced HTTP protection for explicitly gated routers', () => {
    expect(hasForwardAuth(GATED)).toBe(true)
    expect(hasForwardAuth({ ...GATED, 'traefik.enable': 'false' })).toBe(false)
    expect(hasForwardAuth({ 'traefik.enable': 'true' })).toBe(false)
    expect(
      hasForwardAuth({
        'traefik.enable': 'true',
        'traefik.tcp.routers.db.rule': 'HostSNI(`db.example.com`)',
        'traefik.tcp.routers.db.entrypoints': 'postgres',
      }),
    ).toBe(false)
  })

  it('refuses conflicting label values that differ only by case', () => {
    const labels = { ...GATED, 'Traefik.HTTP.Routers.shop-web.Middlewares': 'strip@docker' }
    expect(hasForwardAuth(labels)).toBe(false)
    expect(ungatedContainers([container('shop-web-1', labels)])).toEqual(['shop-web-1'])
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
  const traefik = (ip: string | null, state = 'running', privatePort = 443): ContainerRecord => ({
    ...container('portta-traefik-1', { 'portta.managed': 'true', 'portta.component': 'traefik' }, state),
    ports: [{ ip: ip ?? '', privatePort, publicPort: ip === null ? null : privatePort, type: 'tcp' }],
  })

  it('is one that publishes its HTTP or HTTPS port on every interface', () => {
    expect(gatewayAlreadyPublic([traefik('0.0.0.0')])).toBe(true)
    expect(gatewayAlreadyPublic([traefik('::', 'running', 80)])).toBe(true)
  })

  it('is not one bound to loopback or to one address, stopped, publishing another port, or nothing', () => {
    expect(gatewayAlreadyPublic([traefik('127.0.0.1')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('::1')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('100.64.0.7')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('203.0.113.10')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('0.0.0.0', 'exited')])).toBe(false)
    expect(gatewayAlreadyPublic([traefik('0.0.0.0', 'running', 8080)])).toBe(false)
    expect(gatewayAlreadyPublic([traefik(null)])).toBe(false)
    expect(gatewayAlreadyPublic([])).toBe(false)
  })
})

describe('openCatchAllContainers', () => {
  const wide = { 'traefik.enable': 'true', 'traefik.http.routers.w.rule': 'HostRegexp(`.+`)' }

  it('finds a router with no gate and no address, wherever it runs', () => {
    expect(openCatchAllContainers([{ name: 'loose', state: 'running', labels: wide }]).map((c) => c.name)).toEqual([
      'loose',
    ])
  })

  it('leaves out what is stopped, what names its address, and the panel on its own entrypoint', () => {
    expect(
      openCatchAllContainers([
        { state: 'exited', labels: wide },
        { state: 'running', labels: { 'traefik.enable': 'true', 'traefik.http.routers.w.rule': 'Host(`a.test`)' } },
        {
          state: 'running',
          labels: {
            'portta.managed': 'true',
            'traefik.enable': 'true',
            'traefik.http.routers.portta-panel.rule': 'PathPrefix(`/`)',
            'traefik.http.routers.portta-panel.entrypoints': 'panel',
          },
        },
      ]),
    ).toEqual([])
  })

  it('does not take a label as an excuse', () => {
    expect(openCatchAllContainers([{ state: 'running', labels: { ...wide, 'portta.managed': 'true' } }])).toHaveLength(
      1,
    )
  })

  it.each(['panel', 'somewhere-else'])('counts somebody else on the %s entrypoint', (entrypoint) => {
    const labels = { ...wide, 'traefik.http.routers.w.entrypoints': entrypoint }
    expect(openCatchAllContainers([{ state: 'running', labels }])).toHaveLength(1)
  })

  it('counts a router that also listens on a public entrypoint', () => {
    const labels = { ...wide, 'traefik.http.routers.w.entrypoints': 'panel, websecure' }
    expect(openCatchAllContainers([{ state: 'running', labels }])).toHaveLength(1)
  })
})
