import type { Environment, EnvironmentActionResult } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { PROJECT_A } from './fixtures.ts'
import { type FakeContainer, makeApp, post } from './helpers.ts'

const ordered: FakeContainer[] = [
  {
    id: 'a-web',
    name: 'alpha-web-1',
    image: 'nginx:alpine',
    networks: ['portta'],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'web',
      'com.docker.compose.depends_on': 'api:service_started:false',
      'traefik.enable': 'true',
    },
  },
  {
    id: 'a-api',
    name: 'alpha-api-1',
    image: 'node:alpine',
    networks: ['portta'],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'api',
      'com.docker.compose.depends_on': 'db:service_started:false',
      'traefik.enable': 'true',
    },
  },
  {
    id: 'a-db',
    name: 'alpha-db-1',
    image: 'postgres:alpine',
    networks: ['alpha_default'],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'db',
    },
  },
]

describe('project actions', () => {
  it('stops dependents before dependencies', async () => {
    const { app, docker } = makeApp({ containers: ordered })
    const body = (await (await post(app, '/api/environments/alpha/actions/stop')).json()) as EnvironmentActionResult
    expect(body.ok).toBe(true)
    expect(body.failed).toBe(0)
    expect(docker.calls.filter((call) => call.method === 'stop').map((call) => call.args[0])).toEqual([
      'a-web',
      'a-api',
      'a-db',
    ])
  })

  it('starts dependencies before dependents', async () => {
    const stopped = ordered.map((entry) => ({ ...entry, state: 'exited' }))
    const { app, docker } = makeApp({ containers: stopped })
    await post(app, '/api/environments/alpha/actions/start')
    expect(docker.calls.filter((call) => call.method === 'start').map((call) => call.args[0])).toEqual([
      'a-db',
      'a-api',
      'a-web',
    ])
  })

  it('restarts as an ordered stop then start, not N independent restarts', async () => {
    const { app, docker } = makeApp({ containers: ordered })
    await post(app, '/api/environments/alpha/actions/restart')
    const methods = docker.calls.map((call) => call.method)
    expect(methods.filter((method) => method === 'restart')).toEqual([])
    expect(methods.filter((method) => method === 'stop')).toHaveLength(3)
    expect(methods.filter((method) => method === 'start')).toHaveLength(3)
    expect(methods.indexOf('start')).toBeGreaterThan(methods.lastIndexOf('stop'))
  })

  it('continues after one failure and names it', async () => {
    const { app } = makeApp({ containers: ordered, fail: { stop: ['a-api'] } })
    const body = (await (await post(app, '/api/environments/alpha/actions/stop')).json()) as EnvironmentActionResult
    expect(body.ok).toBe(false)
    expect(body.failed).toBe(1)
    expect(body.succeeded).toBe(2)
    expect(body.results.find((entry) => entry.service === 'api')?.error).toContain('stop failed')
  })

  it('refuses the whole project when a gateway container is in it', async () => {
    const { app, docker } = makeApp({
      containers: [
        ...PROJECT_A,
        {
          id: 'gw-in-alpha',
          name: 'portta-something-1',
          image: 'traefik:v3',
          labels: {
            'portta.managed': 'true',
            'portta.component': 'traefik',
            'com.docker.compose.project': 'alpha',
            'com.docker.compose.service': 'traefik',
          },
        },
      ],
    })
    const response = await post(app, '/api/environments/alpha/actions/stop')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Portta component') })
    expect(docker.calls.some((call) => call.method === 'stop')).toBe(false)
  })

  it('404s a vanished project and names the runner', async () => {
    const { app } = makeApp({ containers: [] })
    const response = await post(app, '/api/environments/ghost/actions/start')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ hint: expect.stringContaining('PORTTA_RUNNER') })
  })

  it('marks a fully running project as not startable via iteration', async () => {
    const { app } = makeApp({ containers: ordered })
    const project = (await (await app.request('/api/environments/alpha')).json()) as Environment
    expect(project.startable).toEqual({
      ok: false,
      reason: 'every service is already running',
      via: null,
    })
  })
})
