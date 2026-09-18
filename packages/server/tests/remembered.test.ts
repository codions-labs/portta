// A remembered environment: seen before, containers gone, row kept. It is
// listed, it can be started through the runner with the paths the panel
// remembered, and it can be forgotten. A live one is never forgotten.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import type { Environment, EnvironmentRunnerStartResult } from 'portta-contracts'
import {
  activityEvents,
  environments as environmentsTable,
  projectEnvironments,
  projects as projectsTable,
} from 'portta-db'
import { describe, expect, it } from 'vitest'
import type { EnvironmentRecord } from '../src/db/environments.ts'
import { loadProjectCatalog } from '../src/services/catalog.ts'
import { createSnapshotCache } from '../src/services/inventory.ts'
import { PROJECT_A } from './fixtures.ts'
import { databasePerFile, del, type FakeContainer, fakeDocker, makeApp, post, testConfig } from './helpers.ts'

const RUNNER: FakeContainer = {
  id: 'gw-runner',
  name: 'portta-runner',
  image: 'codions-labs/portta-apply:0.2.0',
  state: 'created',
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'runner', 'traefik.enable': 'false' },
}

const GAMMA: EnvironmentRecord = {
  id: 'e-gamma',
  composeProject: 'gamma',
  workingDir: '/srv/dev/gamma',
  configFiles: ['/srv/dev/gamma/compose.yaml', '/srv/shared/base.yaml'],
  repoUrl: 'git@github.com:acme/gamma.git',
  repoSubpath: null,
  firstSeenAt: new Date(0),
  lastSeenAt: new Date(0),
  updatedAt: new Date(0),
}

const ALPHA: EnvironmentRecord = {
  ...GAMMA,
  id: 'e-alpha',
  composeProject: 'alpha',
  workingDir: '/srv/dev/alpha',
  configFiles: [],
  repoUrl: null,
}

/** Unplaced: the panel saw it once but never learnt where Compose ran. */
const LOST: EnvironmentRecord = { ...GAMMA, id: 'e-lost', composeProject: 'lost', workingDir: null, configFiles: [] }

function isolated() {
  const root = mkdtempSync(join(tmpdir(), 'portta-remembered-'))
  return { runnerDir: join(root, 'runner'), accessDir: join(root, 'access'), dynamicDir: join(root, 'dynamic') }
}

const seededDatabase = databasePerFile()

/**
 * A database that has seen these environments and nothing else.
 *
 * `forgotten()` asks the table which of them are gone, rather than watching a
 * stand-in record the call: what matters is that the row disappeared, not that
 * a method was invoked.
 */
async function withRecords(records: EnvironmentRecord[], adopted: string[] = []) {
  const seeded = await seededDatabase({ empty: true })
  const names = records.map((record) => record.composeProject)
  await seeded.db.insert(environmentsTable).values(
    records.map((record) => ({
      composeProject: record.composeProject,
      workingDir: record.workingDir,
      configFiles: record.configFiles,
      repoUrl: record.repoUrl,
      repoSubpath: record.repoSubpath,
    })),
  )
  const [project] = await seeded.db
    .insert(projectsTable)
    .values({ slug: 'acme', name: 'Acme' })
    .returning({ id: projectsTable.id })
  if (adopted.length > 0) {
    const rows = await seeded.db
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(inArray(environmentsTable.composeProject, adopted))
    await seeded.db
      .insert(projectEnvironments)
      .values(rows.map((row) => ({ projectId: project!.id, environmentId: row.id, source: 'manual' as const })))
  }

  const forgotten = async (): Promise<string[]> => {
    const remaining = new Set(
      (await seeded.db.select({ name: environmentsTable.composeProject }).from(environmentsTable)).map(
        (row) => row.name,
      ),
    )
    return names.filter((name) => !remaining.has(name))
  }
  const activity = () => seeded.db.select().from(activityEvents)

  return { db: seeded.database, projectId: String(project!.id), forgotten, activity }
}

describe('GET /api/environments with remembered rows', () => {
  it('appends the remembered ones after the live ones with ?all=true', async () => {
    const { db } = await withRecords([ALPHA, GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as {
      environments: Environment[]
    }
    expect(environments.map((environment) => [environment.name, environment.presence])).toEqual([
      ['alpha', 'live'],
      ['gamma', 'remembered'],
    ])
    const gamma = environments[1]!
    expect(gamma.services).toEqual([])
    expect(gamma.serviceCount).toBe(0)
    expect(gamma.integrated).toBe(false)
    expect(gamma.workingDir).toBe('/srv/dev/gamma')
    expect(gamma.operable).toEqual({
      ok: true,
      reason: null,
      workingDir: '/srv/dev/gamma',
      configFiles: GAMMA.configFiles,
    })
    expect(gamma.repoUrl).toBe('git@github.com:acme/gamma.git')
  })

  it('without the runner, startable carries the exact compose command', async () => {
    const { db } = await withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as {
      environments: Environment[]
    }
    expect(environments.find((environment) => environment.name === 'gamma')?.startable).toEqual({
      ok: false,
      reason:
        "docker compose --project-name gamma --project-directory '/srv/dev/gamma' -f '/srv/dev/gamma/compose.yaml' -f '/srv/shared/base.yaml' up -d",
      via: 'runner',
    })
  })

  it('with the runner, a remembered environment is startable through it', async () => {
    const { db } = await withRecords([GAMMA])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as {
      environments: Environment[]
    }
    expect(environments.find((environment) => environment.name === 'gamma')?.startable).toEqual({
      ok: true,
      reason: null,
      via: 'runner',
    })
  })

  it('one with no working directory is not operable and says so', async () => {
    const { db } = await withRecords([LOST])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as {
      environments: Environment[]
    }
    const lost = environments.find((environment) => environment.name === 'lost')!
    expect(lost.operable.ok).toBe(false)
    expect(lost.startable.ok).toBe(false)
    expect(lost.startable.reason).toContain('containers are gone')
  })
})

describe('GET /api/environments/:project for a remembered one', () => {
  it('still 404s for a name nobody remembers', async () => {
    const { db } = await withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    expect((await app.request('/api/environments/nope')).status).toBe(404)
    expect((await app.request('/api/environments/nope/services')).status).toBe(404)
  })
})

describe('POST /api/environments/:project/actions/start for a remembered one', () => {
  it('without the runner: 409, and the hint is the command to run on the host', async () => {
    const { db } = await withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, isolated(), db)
    const response = await post(app, '/api/environments/gamma/actions/start')
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; hint: string }
    expect(body.error).toContain('runner is not available')
    expect(body.hint).toBe(
      "docker compose --project-name gamma --project-directory '/srv/dev/gamma' -f '/srv/dev/gamma/compose.yaml' -f '/srv/shared/base.yaml' up -d",
    )
  })

  it('with the runner: writes an up request carrying the paths and starts it', async () => {
    const { db, activity } = await withRecords([GAMMA])
    const config = isolated()
    const { app, docker } = makeApp({ containers: [...PROJECT_A, RUNNER] }, config, db)
    const response = await post(app, '/api/environments/gamma/actions/start')
    expect(response.status).toBe(200)
    const body = (await response.json()) as EnvironmentRunnerStartResult
    expect(body).toMatchObject({ ok: true, project: 'gamma', action: 'start', via: 'runner' })
    expect(body.runner.available).toBe(true)
    expect(JSON.parse(readFileSync(join(config.runnerDir, 'request.json'), 'utf8'))).toEqual({
      verb: 'up',
      project: 'gamma',
      flags: [],
      workingDir: '/srv/dev/gamma',
      configFiles: ['/srv/dev/gamma/compose.yaml', '/srv/shared/base.yaml'],
    })
    expect(docker.calls.some((call) => call.method === 'start' && call.args[0] === 'gw-runner')).toBe(true)
    expect(await activity()).toContainEqual(
      expect.objectContaining({ kind: 'environment.started', summary: expect.stringContaining('gamma') }),
    )
  })

  it('a live environment still iterates its containers, whatever the database says', async () => {
    const { db } = await withRecords([ALPHA])
    const config = isolated()
    const { app } = makeApp(
      { containers: [...PROJECT_A.map((entry) => ({ ...entry, state: 'exited' })), RUNNER] },
      config,
      db,
    )
    const response = await post(app, '/api/environments/alpha/actions/start')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ action: 'start', requested: 4 })
  })

  it('refuses one with no working directory', async () => {
    const { db } = await withRecords([LOST])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated(), db)
    expect((await post(app, '/api/environments/lost/actions/start')).status).toBe(409)
  })

  it("refuses Portta's own project by name", async () => {
    const { db } = await withRecords([{ ...GAMMA, composeProject: 'portta', workingDir: '/opt/portta' }])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated(), db)
    const response = await post(app, '/api/environments/portta/actions/start')
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toContain("Portta's own project")
  })
})

describe('DELETE /api/environments/:project', () => {
  it('forgets a remembered environment', async () => {
    const { db, forgotten, activity } = await withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const response = await del(app, '/api/environments/gamma')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, forgotten: 'gamma' })
    expect(await forgotten()).toEqual(['gamma'])
    expect(await activity()).toContainEqual(expect.objectContaining({ kind: 'environment.forgotten' }))
  })

  it('refuses a live one: stop and remove it first', async () => {
    const { db, forgotten } = await withRecords([ALPHA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const response = await del(app, '/api/environments/alpha')
    expect(response.status).toBe(409)
    expect(((await response.json()) as { hint: string }).hint).toContain('stop and remove it first')
    expect(await forgotten()).toEqual([])
  })

  it('404s for a name nobody remembers, 503 with no persistence', async () => {
    const { db } = await withRecords([GAMMA])
    expect((await del(makeApp({ containers: PROJECT_A }, {}, db).app, '/api/environments/nope')).status).toBe(404)
    expect((await del(makeApp({ containers: PROJECT_A }).app, '/api/environments/gamma')).status).toBe(503)
  })
})

describe('the Project catalogue', () => {
  it('keeps a remembered environment the Project adopted by hand, not running', async () => {
    const { db, projectId } = await withRecords([GAMMA], ['gamma'])
    const docker = fakeDocker({ containers: PROJECT_A })
    const config = testConfig()
    const snapshot = await createSnapshotCache(docker.client, config, 0).get()
    const catalog = await loadProjectCatalog(db, snapshot, config)
    expect(catalog.environments.get(projectId)).toEqual([
      {
        environment: 'gamma',
        source: 'manual',
        attribution: 'resolved',
        running: false,
        serviceCount: 0,
        runningCount: 0,
        completedCount: 0,
        unhealthyCount: 0,
        urls: [],
      },
    ])
  })
})

describe('removal keeps the environment remembered', () => {
  const alpha: EnvironmentRecord = {
    id: '1',
    composeProject: 'alpha',
    workingDir: '/srv/dev/alpha',
    configFiles: ['/srv/dev/alpha/compose.yaml'],
    repoUrl: null,
    repoSubpath: null,
    firstSeenAt: new Date(0),
    lastSeenAt: new Date(0),
    updatedAt: new Date(0),
  } as EnvironmentRecord

  it('down, with or without volumes, leaves the row alone', async () => {
    const { db, forgotten } = await withRecords([alpha])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated(), db)
    await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: true,
      directory: false,
    })
    expect(await forgotten()).toEqual([])
  })

  it('removing the directory forgets it in the same step', async () => {
    const { db, forgotten } = await withRecords([alpha])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated(), db)
    const response = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: true,
      directory: true,
    })
    expect(response.status).toBe(200)
    expect(await forgotten()).toEqual(['alpha'])
  })
})
