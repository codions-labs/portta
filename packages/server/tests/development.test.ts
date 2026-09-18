// The development surfaces: consolidated services, the context, attributed
// resources and the dashboard. The presenters are tested on their own; what is
// asserted here is that the routes feed them from the right places and stay
// honest without a database.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { projectEnvironments, projects as projectsTable } from 'portta-db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/api/index.ts'
import type { Database } from '../src/db/index.ts'
import type { AppDeps } from '../src/deps.ts'
import { taskflowServerModule } from '../src/modules/taskflow/index.ts'
import type { ForgeRequest } from '../src/services/issues/host-client.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { databasePerFile, fakeForge, makeApp, post } from './helpers.ts'

const seededDatabase = databasePerFile()

/**
 * A Project with a description and the environment it adopted — the situation
 * the development surfaces exist to summarise. Its repository stays: the
 * GitHub remote on it is what says where the Project's work lives.
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

const ISSUE = {
  number: 113,
  title: 'Fix auth',
  state: 'open',
  body: 'the session cookie expires too early',
  author: { login: 'ada' },
  assignees: [{ login: 'claude' }],
  labels: [],
  milestone: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  url: 'https://github.com/acme/api/issues/113',
  repository: { nameWithOwner: 'acme/api' },
}

/** A signed-in host whose `gh` answers with one issue, listed and read. */
function host(): ReturnType<typeof fakeForge> {
  return fakeForge((request: ForgeRequest) => {
    if (request.path === '/status') {
      return {
        github: { available: true, authenticated: true, account: 'ada', detail: null },
        linear: { available: false, authenticated: false, account: null, detail: 'no key' },
      }
    }
    if (request.path === '/assigned') return [ISSUE]
    if (request.path === '/issues/113') return { ...ISSUE, comments: [] }
    return []
  })
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

describe('the development dashboard', () => {
  // An empty list with no provider behind it would read as "nothing to do".
  // The dashboard says the work is not known, and why.
  it('answers with no provider, and says so rather than showing an empty list', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await app.request('/api/overview')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      work: { available: boolean; assigned: unknown[]; unavailableReason: string | null }
      projects: unknown[]
      runtime: { environmentsRunning: number }
      gateway: { up: boolean }
    }
    expect(body.work.available).toBe(false)
    expect(body.work.assigned).toEqual([])
    expect(body.work.unavailableReason).toBeTruthy()
    expect(body.projects).toEqual([])
    expect(body.runtime.environmentsRunning).toBeGreaterThan(0)
    expect(body.gateway.up).toBe(true)
  })

  it('lists what the host is assigned and summarises the projects when there is one', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work(), host().client)
    const body = (await (await app.request('/api/overview')).json()) as {
      work: { available: boolean; assigned: Array<{ ref: string; title: string }> }
      projects: Array<{ slug: string; runningEnvironments: number }>
    }
    expect(body.work.available).toBe(true)
    expect(body.work.assigned[0]).toMatchObject({ ref: 'github:acme/api#113', title: 'Fix auth' })
    expect(body.projects[0]).toMatchObject({ slug: 'produto', runningEnvironments: 1 })
  })
})

describe('the development context and resources', () => {
  it('needs a database, and a project that exists', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    expect((await app.request('/api/projects/produto/context')).status).toBe(503)
    const withDb = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work())
    expect((await withDb.app.request('/api/projects/nope/context')).status).toBe(404)
  })

  it('hands an agent the project, its environments with services and the platform rules', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work(), host().client)
    const response = await app.request('/api/projects/produto/context', { headers: { 'X-Portta-Actor': 'claude' } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      schema: string
      version: number
      actor: string
      project: { slug: string }
      issue: unknown
      repositories: Array<{ worktrees: unknown[] }>
      environments: Array<{ name: string; services: unknown[]; startCommand: string }>
      instructions: { platform: string }
      commands: Record<string, string>
      diagnostics: Array<{ id: string }>
    }
    expect(body.schema).toBe('development-context')
    expect(body.version).toBe(1)
    expect(body.actor).toBe('claude')
    expect(body.project.slug).toBe('produto')
    expect(body.issue).toBeNull()
    expect(body.environments[0]).toMatchObject({ name: 'alpha', startCommand: 'portta envs start alpha' })
    expect(body.environments[0]?.services.length).toBeGreaterThan(0)
    expect(body.instructions.platform).toContain('Never')
    // Taskflow is not mounted here: no worktrees, and no claim that they are unknown.
    expect(body.repositories[0]?.worktrees).toEqual([])
    expect(body.diagnostics.map((d) => d.id)).toEqual(['repository-path-unknown:api'])
  })

  // The context is what an agent needs before it starts, so the issue it named
  // comes in whole — body and comments — rather than as a reference to fetch.
  it('includes the named issue in full, and refuses a ref no provider could address', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, await work(), host().client)
    const response = await app.request('/api/projects/produto/context?issue=github%3Aacme%2Fapi%23113')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      issue: { ref: string; body: string } | null
      instructions: { issue: string | null }
      commands: Record<string, string>
    }
    expect(body.issue).toMatchObject({ ref: 'github:acme/api#113' })
    expect(body.instructions.issue).toContain('the session cookie expires too early')
    expect(body.commands.closeIssue).toBe('portta issues close github:acme/api#113 --project produto')

    expect((await app.request('/api/projects/produto/context?issue=not-a-ref')).status).toBe(400)
  })
})

describe('the development context with Taskflow mounted', () => {
  const TOKEN = 'taskflow-host-token'
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'portta-context-')), 'token')
  writeFileSync(tokenFile, TOKEN)
  let daemon: Server
  let hostUrl: string
  let answering = true

  beforeAll(async () => {
    daemon = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://host')
      if (!answering || request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(503).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      if (url.pathname === '/api/modules/taskflow/api/projects') {
        response.end(
          JSON.stringify({
            projects: [
              { prefix: 'shop', name: 'shop', path: '/home/ana/code/shop/', active: false },
              { prefix: 'stray', name: 'stray', path: '/home/ana/elsewhere', active: false },
            ],
          }),
        )
        return
      }
      if (url.pathname === '/api/modules/taskflow/shop/api/worktrees') {
        response.end(
          JSON.stringify({
            worktrees: [
              {
                path: '/home/ana/code/shop-wt/issue-12',
                branch: 'issue-12',
                baseBranch: 'main',
                archived: false,
                environmentId: 'env_abc',
              },
              { path: '/home/ana/code/shop-wt/old', branch: 'old', archived: true },
            ],
          }),
        )
        return
      }
      response.end(JSON.stringify({ worktrees: [{ path: '/home/ana/elsewhere/x', branch: 'x', archived: false }] }))
    })
    await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve))
    hostUrl = `http://127.0.0.1:${(daemon.address() as { port: number }).port}`
  })

  afterAll(() => {
    daemon.closeAllConnections()
    daemon.close()
  })

  async function panel() {
    const seeded = await seededDatabase()
    await seeded.database.repositories.update(seeded.ids.repository, { localPath: '/home/ana/code/shop' })
    const {
      app: _base,
      docker,
      ...deps
    } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { hostUrl, hostTokenFile: tokenFile }, seeded.database)
    const composed: AppDeps = { ...deps, client: docker.client, auth: null, modules: [taskflowServerModule] }
    return createApp(composed)
  }

  it('lists the active worktrees of the Taskflow Project that serves the repository, and no other', async () => {
    answering = true
    const body = (await (await (await panel()).request('/api/projects/produto/context')).json()) as {
      repositories: Array<{ worktrees: unknown[] }>
      diagnostics: Array<{ id: string }>
    }
    expect(body.repositories[0]?.worktrees).toEqual([
      {
        path: '/home/ana/code/shop-wt/issue-12',
        branch: 'issue-12',
        base: 'main',
        environmentId: 'env_abc',
        environment: null,
      },
    ])
    expect(body.diagnostics.map((d) => d.id)).not.toContain('taskflow-unreachable')
  })

  it('says the worktrees are unknown, not absent, when the daemon does not answer', async () => {
    answering = false
    const body = (await (await (await panel()).request('/api/projects/produto/context')).json()) as {
      repositories: Array<{ worktrees: unknown[] }>
      diagnostics: Array<{ id: string; status: string }>
    }
    expect(body.repositories[0]?.worktrees).toEqual([])
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ id: 'taskflow-unreachable', status: 'warn' }))
  })
})
