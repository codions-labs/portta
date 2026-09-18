import type { ContainerSummary, ServiceTraefik, TraefikVerdict } from 'portta-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { fetchVerdict, routersFor } from '../src/services/traefik.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp, testConfig } from './helpers.ts'

const ROUTERS = [
  {
    name: 'alpha-web@docker',
    rule: 'Host(`alpha-web.localhost`)',
    entryPoints: ['web'],
    middlewares: ['portta-secure-headers@file'],
    service: 'alpha-web',
    provider: 'docker',
    status: 'enabled',
  },
  {
    name: 'broken@docker',
    rule: 'Host(`broken.localhost`)',
    entryPoints: ['web'],
    service: 'broken',
    provider: 'docker',
    status: 'disabled',
    error: ['the service "broken@docker" does not exist'],
  },
]

const SERVICES = [{ name: 'alpha-web@docker', loadBalancer: { servers: [{ url: 'http://172.18.0.4:80' }] } }]

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal('fetch', async (input: string) => {
    const body = handler(String(input))
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const dashboardOn = { dashboardEnabled: true, traefikApi: 'http://traefik:8080' }

beforeEach(() => {
  stubFetch((url) => (url.includes('/services') ? SERVICES : ROUTERS))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('where the Traefik API is', () => {
  it('is `traefik` when Traefik has its own namespace', () => {
    expect(loadConfig({}).traefikApi).toBe('http://traefik:8080')
  })

  it("is `tailscale` when Traefik shares that container's namespace", () => {
    vi.stubEnv('PORTTA_PROFILE', 'remote-private')
    vi.stubEnv('TAILSCALE_ENABLED', 'true')
    expect(loadConfig({}).traefikApi).toBe('http://tailscale:8080')
    vi.unstubAllEnvs()
  })

  // The name and the overlay come from one `attachment()` in portta-core, so a
  // local profile keeps Traefik's own namespace however Tailscale is set: the
  // sidecar attachment is a remote-profile decision. The two must not be able
  // to disagree, or the panel would poll a host the gateway never created.
  it("keeps Traefik's own namespace on the local profile, whatever Tailscale says", () => {
    vi.stubEnv('PORTTA_PROFILE', 'local')
    vi.stubEnv('TAILSCALE_ENABLED', 'true')
    expect(loadConfig({}).traefikApi).toBe('http://traefik:8080')
    vi.unstubAllEnvs()
  })
})

describe('reading the verdict', () => {
  it('reports each router as Traefik reports it, with its resolved backend', async () => {
    const verdict = await fetchVerdict(testConfig(dashboardOn))
    expect(verdict.available).toBe(true)
    const router = verdict.routers.find((entry) => entry.name === 'alpha-web@docker')
    expect(router?.status).toBe('enabled')
    expect(router?.entryPoints).toEqual(['web'])
    expect(router?.middlewares).toEqual(['portta-secure-headers@file'])
    expect(router?.servers).toEqual(['http://172.18.0.4:80'])
  })

  it("keeps Traefik's own error text for a router it refused", async () => {
    const verdict = await fetchVerdict(testConfig(dashboardOn))
    const router = verdict.routers.find((entry) => entry.name === 'broken@docker')
    expect(router?.status).toBe('disabled')
    expect(router?.errors[0]).toContain('does not exist')
  })

  it('says the API was not asked, rather than that nothing is wrong', async () => {
    const verdict = await fetchVerdict(testConfig({ dashboardEnabled: false }))
    expect(verdict.available).toBe(false)
    expect(verdict.reason).toContain('PORTTA_DASHBOARD=false')
    expect(verdict.routers).toEqual([])
  })

  it('degrades to the label-derived view when Traefik cannot be reached', async () => {
    stubFetch(() => new Error('connect ECONNREFUSED'))
    const verdict = await fetchVerdict(testConfig(dashboardOn))
    expect(verdict.available).toBe(false)
    expect(verdict.reason).toContain('could not reach the Traefik API')
  })

  it('still answers when the services endpoint fails on its own', async () => {
    stubFetch((url) => (url.includes('/services') ? new Error('nope') : ROUTERS))
    const verdict = await fetchVerdict(testConfig(dashboardOn))
    expect(verdict.available).toBe(true)
    expect(verdict.routers[0]?.servers).toEqual([])
  })
})

describe('matching a router to a service', () => {
  const container = { urls: [{ host: 'alpha-web.localhost' }] } as ContainerSummary
  const verdict = { routers: [] } as unknown as TraefikVerdict

  it('matches on the hostname, so a project that named its own router still matches', async () => {
    const full = await fetchVerdict(testConfig(dashboardOn))
    expect(routersFor(container, full).map((router) => router.name)).toEqual(['alpha-web@docker'])
  })

  it('matches nothing for a service with no URL at all', () => {
    expect(routersFor({ urls: [] } as unknown as ContainerSummary, verdict)).toEqual([])
  })
})

describe('GET /api/services/:id/traefik', () => {
  it("answers with Traefik's routers for that container", async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, dashboardOn)
    const response = await app.request('/api/services/a-web/traefik')
    const body = (await response.json()) as ServiceTraefik

    expect(body.available).toBe(true)
    expect(body.expectedHosts).toEqual(['alpha-web.localhost'])
    expect(body.routers[0]?.name).toBe('alpha-web@docker')
    expect(body.routers[0]?.dashboardUrl).toContain('/dashboard/#/http/routers/')
  })

  it('answers with no routers, and a reason, when the API is off', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { dashboardEnabled: false })
    const body = (await (await app.request('/api/services/a-web/traefik')).json()) as ServiceTraefik
    expect(body.available).toBe(false)
    expect(body.routers).toEqual([])
  })
})

describe('the routing diagnostic', () => {
  it('fails a service Traefik never routed, which the labels cannot show', async () => {
    stubFetch((url) => (url.includes('/services') ? [] : []))
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, dashboardOn)
    const body = (await (
      await app.request('/api/gateway/doctor', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
      })
    ).json()) as { checks: { id: string; status: string; detail: string }[] }

    const check = body.checks.find((entry) => entry.id === 'traefik-no-router')
    expect(check?.status).toBe('fail')
    expect(check?.detail).toContain('alpha-web-1')
  })

  it('warns that Traefik was not asked when the dashboard is off', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { dashboardEnabled: false })
    const body = (await (
      await app.request('/api/gateway/doctor', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
      })
    ).json()) as { checks: { id: string; status: string }[] }

    expect(body.checks.find((entry) => entry.id === 'traefik-verdict')?.status).toBe('warn')
  })

  it('is absent from the page-render path entirely', async () => {
    // /api/status must never make a network call to Traefik: it is the one
    // endpoint every page waits on.
    const calls = vi.fn()
    stubFetch((url) => {
      calls()
      return url.includes('/services') ? SERVICES : ROUTERS
    })
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, dashboardOn)
    await app.request('/api/status')
    expect(calls).not.toHaveBeenCalled()
  })
})
