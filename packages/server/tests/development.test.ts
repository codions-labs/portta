// The development surfaces: consolidated services and the overview. The
// presenters are tested on their own; what is asserted here is that the routes
// feed them from the right places and stay honest without a database.

import { eq } from 'drizzle-orm'
import { projectEnvironments, projects as projectsTable } from 'portta-db'
import { describe, expect, it } from 'vitest'
import type { Database } from '../src/db/index.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { databasePerFile, makeApp, post } from './helpers.ts'

const seededDatabase = databasePerFile()

/**
 * A Project with a description and the environment it adopted — the situation
 * the overview exists to summarise.
 */
async function work(): Promise<Database> {
  const seeded = await seededDatabase()
  const projectId = Number(seeded.ids.project)

  await seeded.db.update(projectsTable).set({ description: 'The product' }).where(eq(projectsTable.id, projectId))
  await seeded.db.insert(projectEnvironments).values({
    projectId,
    environmentId: Number(seeded.ids.environment),
    source: 'manual',
  })
  return seeded.database
}

describe('consolidated services', () => {
  it('folds every service of an environment into one row each', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await app.request('/api/environments/alpha/services')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      environment: string
      services: Array<{
        name: string
        access: { kind: string; primary: { url: string } | null }
        actions: { stop: boolean }
      }>
    }
    expect(body.environment).toBe('alpha')
    const web = body.services.find((service) => service.name === 'web')
    expect(web?.access.kind).toBe('http')
    expect(web?.access.primary?.url).toContain('alpha-web')
    expect(web?.actions.stop).toBe(true)
    expect(body.services.some((service) => service.access.kind === 'tcp')).toBe(true)
  })

  it('answers 404 for an environment that is not running', async () => {
    const { app } = makeApp({ containers: [...GATEWAY] })
    expect((await app.request('/api/environments/ghost/services')).status).toBe(404)
  })

  it('runs an action on one service by name and refuses an unknown verb', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const ok = await post(app, '/api/environments/alpha/services/web/actions/restart')
    expect(ok.status).toBe(200)
    expect(docker.calls.some((call) => call.method.toLowerCase().includes('restart'))).toBe(true)
    expect((await post(app, '/api/environments/alpha/services/web/actions/explode')).status).toBe(400)
    expect((await post(app, '/api/environments/alpha/services/nope/actions/start')).status).toBe(404)
  })
})

describe('the overview', () => {
  it('answers without a database, with the runtime and the gateway', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await app.request('/api/overview')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      projects: unknown[]
      runtime: { environmentsRunning: number }
      gateway: { up: boolean }
    }
    expect(body.projects).toEqual([])
    expect(body.runtime.environmentsRunning).toBeGreaterThan(0)
    expect(body.gateway.up).toBe(true)
  })

  it('summarises the projects when there is one', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work())
    const body = (await (await app.request('/api/overview')).json()) as {
      projects: Array<{ slug: string; runningEnvironments: number }>
    }
    expect(body.projects[0]).toMatchObject({ slug: 'produto', runningEnvironments: 1 })
  })
})
