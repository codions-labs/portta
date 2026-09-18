import type { ContainerSummary, Environment, Overview } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { BRIDGE, FULL_HOST, GATEWAY, PROJECT_A } from './fixtures.ts'
import { del, makeApp, post } from './helpers.ts'

describe('GET /api/status', () => {
  it('says the gateway is down when Traefik is not there', async () => {
    const { app } = makeApp({ containers: PROJECT_A })
    const overview = (await (await app.request('/api/status')).json()) as Overview
    expect(overview.gateway.up).toBe(false)
    expect(overview.problems.some((problem) => problem.id === 'traefik')).toBe(true)
  })

  it('does not count a stopped container as an active route', async () => {
    const stoppedRoute = {
      ...PROJECT_A[0]!,
      id: 'stopped-web',
      name: 'stopped-web-1',
      state: 'exited' as const,
    }
    const { app } = makeApp({ containers: [...GATEWAY, stoppedRoute] })
    const overview = (await (await app.request('/api/status')).json()) as Overview

    expect(overview.gateway.routes).toBe(0)
    expect(overview.counts.routes).toBe(0)
    expect(overview.urls).toEqual([])
  })

  it('reports an unhealthy service as a problem', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const overview = (await (await app.request('/api/status')).json()) as Overview
    expect(overview.problems.find((problem) => problem.id === 'unhealthy')?.detail).toContain('beta-web-1')
  })
})

describe('GET /api/environments', () => {
  it('lists integrated projects only', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const { environments } = (await (await app.request('/api/environments')).json()) as { environments: Environment[] }
    expect(environments.map((environment) => environment.name)).toEqual(['alpha', 'beta'])
  })

  it('includes external ones on request, still flagged', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as {
      environments: Environment[]
    }
    expect(environments.find((environment) => environment.name === 'external')?.integrated).toBe(false)
  })

  it('404s for a project that is not running', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    expect((await app.request('/api/environments/nope')).status).toBe(404)
  })
})

describe('GET /api/docker/containers', () => {
  it('filters by ownership', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const body = (await (await app.request('/api/docker/containers?ownership=external')).json()) as {
      containers: ContainerSummary[]
    }
    expect(body.containers.map((container) => container.name)).toEqual(['external-postgres'])
  })

  it('filters by state', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const body = (await (await app.request('/api/docker/containers?state=stopped')).json()) as {
      containers: ContainerSummary[]
    }
    expect(body.containers.map((container) => container.name)).toEqual(['some-old-container'])
  })

  it('searches across name, image, project and hostname', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const byHost = (await (await app.request('/api/docker/containers?q=api.alpha.test')).json()) as {
      containers: ContainerSummary[]
    }
    expect(byHost.containers.map((container) => container.name)).toEqual(['alpha-api-1'])

    const byImage = (await (await app.request('/api/docker/containers?q=redis')).json()) as {
      containers: ContainerSummary[]
    }
    expect(byImage.containers).toHaveLength(1)
  })

  it('ignores a filter value it does not know instead of failing', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await app.request('/api/docker/containers?ownership=nonsense')
    expect(response.status).toBe(200)
  })
})

describe('container actions', () => {
  it('restarts an external container', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await post(app, '/api/docker/containers/ext-pg/restart')
    expect(response.status).toBe(200)
    expect(docker.calls).toContainEqual({ method: 'restart', args: ['ext-pg'] })
  })

  it('starts a stopped one', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    expect((await post(app, '/api/docker/containers/solo-old/start')).status).toBe(200)
    expect(docker.calls).toContainEqual({ method: 'start', args: ['solo-old'] })
  })

  it('refuses to start something already running', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await post(app, '/api/docker/containers/ext-pg/start')
    expect(response.status).toBe(409)
  })

  it('refuses to touch a gateway component', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await post(app, '/api/docker/containers/gw-traefik/stop')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Portta component') })
    expect(docker.calls.some((call) => call.method === 'stop')).toBe(false)
  })

  it('points at the Access page for a TCP bridge', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, BRIDGE] })
    const response = await post(app, '/api/docker/containers/bridge-1/restart')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ hint: expect.stringContaining('Access page') })
  })

  it('404s for a container that vanished', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await post(app, '/api/docker/containers/ghost/restart')
    expect(response.status).toBe(404)
  })
})

describe('removing a container', () => {
  it('takes the container and says what it kept', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await del(app, '/api/docker/containers/ext-pg', { confirm: true, force: true })
    expect(response.status).toBe(200)
    expect(docker.removed).toEqual(['ext-pg'])
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('volumes, networks and images were kept'),
    })
  })

  it('refuses without an explicit confirmation', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await del(app, '/api/docker/containers/ext-pg', {})
    expect(response.status).toBe(400)
    expect(docker.removed).toEqual([])
  })

  it('refuses to remove a running container that was not confirmed as running', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await del(app, '/api/docker/containers/ext-pg', { confirm: true })
    expect(response.status).toBe(409)
    expect(docker.removed).toEqual([])
  })

  it('never removes a gateway component', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await del(app, '/api/docker/containers/gw-traefik', { confirm: true, force: true })
    expect(response.status).toBe(403)
    expect(docker.removed).toEqual([])
  })

  it('previews exactly what stays behind', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const preview = await (await app.request('/api/docker/containers/ext-pg/removal-preview')).json()
    expect(preview).toMatchObject({ allowed: true, ownership: 'external' })
    expect(preview.namedVolumes).toEqual(['external_pgdata'])
    expect(preview.warnings.join(' ')).toContain('named volume(s) stay on the host')
    expect(preview.warnings.join(' ')).toContain('networks are kept')
  })

  it('marks a gateway component as not removable in the preview', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const preview = await (await app.request('/api/docker/containers/gw-traefik/removal-preview')).json()
    expect(preview.allowed).toBe(false)
  })

  it('does not touch a sibling in the same Compose project', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    await del(app, '/api/docker/containers/a-redis', { confirm: true, force: true })
    expect(docker.removed).toEqual(['a-redis'])
  })
})

describe('logs', () => {
  it('clamps an absurd tail rather than refusing', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    expect((await app.request('/api/docker/containers/ext-pg/logs?tail=999999')).status).toBe(200)
    expect((await app.request('/api/docker/containers/ext-pg/logs?tail=abc')).status).toBe(200)
  })
})

describe('the gateway endpoints', () => {
  it('restarts only the components it is asked for', async () => {
    const { app, docker } = makeApp({ containers: FULL_HOST })
    const response = await post(app, '/api/gateway/restart', { components: ['traefik'] })
    expect(response.status).toBe(200)
    expect(docker.calls).toContainEqual({ method: 'restart', args: ['gw-traefik'] })
  })

  it('refuses a component that is not a gateway component', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    expect((await post(app, '/api/gateway/restart', { components: ['postgres'] })).status).toBe(400)
  })

  it('runs diagnostics and reports failures separately from warnings', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const doctor = await (await post(app, '/api/gateway/doctor')).json()
    expect(doctor.checks.length).toBeGreaterThan(5)
    expect(doctor.hostCommand).toBe('./bin/portta doctor')
  })

  it('serves gateway logs for known components only', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    expect((await app.request('/api/gateway/logs?component=traefik')).status).toBe(200)
    expect((await app.request('/api/gateway/logs?component=postgres')).status).toBe(400)
  })
})

describe('the API refuses what it should', () => {
  it('rejects a cross-origin write', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await app.request('/api/docker/containers/ext-pg/restart', {
      method: 'POST',
      body: '{}',
      headers: { origin: 'https://evil.example', host: 'localhost:8081' },
    })
    expect(response.status).toBe(403)
  })

  it('refuses every write in read-only mode', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, { readOnly: true })
    expect((await post(app, '/api/docker/containers/ext-pg/restart')).status).toBe(403)
    expect((await app.request('/api/status')).status).toBe(200)
  })

  it('404s an unknown endpoint instead of falling through', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const response = await app.request('/api/nope')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('no such endpoint') })
  })
})
