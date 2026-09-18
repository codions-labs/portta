import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EnvironmentRemovalPreview, ProjectRebuildResult, ProjectRemoveResult } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { PROJECT_A } from './fixtures.ts'
import { type FakeContainer, makeApp, post } from './helpers.ts'

const RUNNER: FakeContainer = {
  id: 'gw-runner',
  name: 'portta-runner',
  image: 'codions-labs/portta-apply:0.2.0',
  state: 'created',
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'runner', 'traefik.enable': 'false' },
}

const withVolume: FakeContainer[] = PROJECT_A.map((entry) =>
  entry.id === 'a-postgres'
    ? {
        ...entry,
        mounts: [
          {
            Type: 'volume',
            Name: 'alpha_pgdata',
            Source: '/var/lib/docker/volumes/alpha_pgdata/_data',
            Destination: '/var/lib/postgresql/data',
            RW: true,
          },
        ],
      }
    : entry,
)

function isolated() {
  const root = mkdtempSync(join(tmpdir(), 'portta-op-'))
  return { runnerDir: join(root, 'runner'), accessDir: join(root, 'access'), dynamicDir: join(root, 'dynamic') }
}

function requestFile(runnerDir: string): { verb: string; project: string; flags: string[] } {
  return JSON.parse(readFileSync(join(runnerDir, 'request.json'), 'utf8')) as {
    verb: string
    project: string
    flags: string[]
  }
}

describe('GET /api/environments/:project/removal-preview', () => {
  it('lists containers, networks, named volumes and the working directory', async () => {
    const { app } = makeApp({ containers: withVolume }, isolated())
    const response = await app.request('/api/environments/alpha/removal-preview')
    expect(response.status).toBe(200)
    const body = (await response.json()) as EnvironmentRemovalPreview
    expect(body.environment).toBe('alpha')
    expect(body.containers.map((container) => container.service)).toEqual(
      expect.arrayContaining(['web', 'api', 'postgres']),
    )
    expect(body.volumes).toEqual([{ name: 'alpha_pgdata', sizeBytes: null }])
    expect(body.workingDir).toBe('/srv/dev/alpha')
    expect(body.records.accessBridges).toEqual([])
  })

  it('lists current JSON tunnel records owned by the environment', async () => {
    const config = isolated()
    const directory = join(config.accessDir, 'tunnels')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'a1b2c3.json'), JSON.stringify({ id: 'a1b2c3', project: 'alpha' }))
    writeFileSync(join(directory, 'd4e5f6.json'), JSON.stringify({ id: 'd4e5f6', project: 'beta' }))
    const { app } = makeApp({ containers: withVolume }, config)
    const body = (await (
      await app.request('/api/environments/alpha/removal-preview')
    ).json()) as EnvironmentRemovalPreview
    expect(body.records.accessFiles).toEqual(['tunnels/a1b2c3.json'])
  })

  it('refuses a project that contains a Portta component', async () => {
    const { app } = makeApp({
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
    const response = await app.request('/api/environments/alpha/removal-preview')
    expect(response.status).toBe(403)
  })
})

describe('POST /api/environments/:project/operations/rebuild', () => {
  it('writes a build request and starts the runner', async () => {
    const { app, docker, config } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated())
    const response = await post(app, '/api/environments/alpha/operations/rebuild', { noCache: false })
    expect(response.status).toBe(200)
    const body = (await response.json()) as ProjectRebuildResult
    expect(body.via).toBe('runner')
    expect(body.noCache).toBe(false)
    expect(requestFile(config.runnerDir)).toEqual({ verb: 'build', project: 'alpha', flags: [] })
    expect(docker.calls.some((call) => call.method === 'start' && call.args[0] === 'gw-runner')).toBe(true)
  })

  it('passes no-cache only when asked', async () => {
    const { app, config } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated())
    await post(app, '/api/environments/alpha/operations/rebuild', { noCache: true })
    expect(requestFile(config.runnerDir)).toEqual({ verb: 'build', project: 'alpha', flags: ['no-cache'] })
  })
})

describe('POST /api/environments/:project/operations/remove', () => {
  it('refuses a confirmation that does not match', async () => {
    const { app, docker, config } = makeApp({ containers: PROJECT_A }, isolated())
    const response = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'ALPHA',
      volumes: false,
      directory: false,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('confirmation') })
    expect(docker.calls.some((call) => call.method === 'remove')).toBe(false)
    expect(existsSync(join(config.runnerDir, 'request.json'))).toBe(false)
  })

  it('keep-data without the runner removes containers and does not mention volumes', async () => {
    const { app, docker } = makeApp({ containers: withVolume }, isolated())
    const response = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: false,
      directory: false,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as ProjectRemoveResult
    expect(body.mode).toBe('keep-data')
    expect(body.volumes).toBe(false)
    expect(body.via).toBe('iteration')
    expect(docker.calls.filter((call) => call.method === 'remove').length).toBeGreaterThan(0)
    expect(body.remainingCommands.some((command) => command.includes('--volumes'))).toBe(false)
    expect(body.remainingCommands.some((command) => command.includes('rm -rf'))).toBe(false)
    expect(body.note).toContain('GitHub')
  })

  it('keep-data with the runner writes down, not down-volumes', async () => {
    const { app, docker, config } = makeApp({ containers: [...withVolume, RUNNER] }, isolated())
    const response = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: false,
      directory: false,
    })
    expect(response.status).toBe(200)
    expect(requestFile(config.runnerDir)).toEqual({ verb: 'down', project: 'alpha', flags: [] })
    expect(docker.calls.some((call) => call.method === 'start' && call.args[0] === 'gw-runner')).toBe(true)
    expect(docker.calls.some((call) => call.method === 'remove' && call.args[0] === 'a-postgres')).toBe(false)
  })

  it('and-local-data with the runner writes down-volumes', async () => {
    const { app, config } = makeApp({ containers: [...withVolume, RUNNER] }, isolated())
    await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: true,
      directory: false,
    })
    expect(requestFile(config.runnerDir)).toEqual({ verb: 'down-volumes', project: 'alpha', flags: [] })
  })

  it('refuses directory removal on a dirty tree unless overridden', async () => {
    const gitDir = mkdtempSync(join(tmpdir(), 'portta-git-'))
    const key = 'abcdef012345'
    writeFileSync(
      join(gitDir, 'index.json'),
      JSON.stringify({
        version: 1,
        collectedAt: Math.floor(Date.now() / 1000),
        environments: { alpha: key },
        repositories: [],
      }),
    )
    writeFileSync(
      join(gitDir, `${key}.json`),
      JSON.stringify({
        collectedAt: Math.floor(Date.now() / 1000),
        workingDir: '/srv/dev/alpha',
        git: {
          dirty: true,
          staged: 1,
          unstaged: 2,
          untracked: 0,
          detached: false,
          head: { sha: 'abc', shortSha: 'abc', subject: '', author: '', date: 0 },
        },
      }),
    )
    const { app, config } = makeApp({ containers: [...PROJECT_A, RUNNER] }, { gitDir, ...isolated() })
    const refused = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: true,
      directory: true,
    })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining('dirty') })
    expect(existsSync(join(config.runnerDir, 'request.json'))).toBe(false)

    const allowed = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: true,
      directory: true,
      overrideDirty: true,
    })
    expect(allowed.status).toBe(200)
    expect(requestFile(config.runnerDir)).toEqual({ verb: 'down-volumes', project: 'alpha', flags: ['directory'] })
  })

  it('refuses a directory that walks up', async () => {
    const walked: FakeContainer[] = PROJECT_A.map((entry) => ({
      ...entry,
      labels: {
        ...entry.labels,
        'com.docker.compose.project.working_dir': '/srv/dev/../etc',
      },
    }))
    const { app } = makeApp({ containers: [...walked, RUNNER] }, isolated())
    const response = await post(app, '/api/environments/alpha/operations/remove', {
      confirmation: 'alpha',
      volumes: true,
      directory: true,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('walks up') })
  })

  it('without the runner, directory removal is a printed command', async () => {
    const { app } = makeApp({ containers: PROJECT_A }, isolated())
    const body = (await (
      await post(app, '/api/environments/alpha/operations/remove', {
        confirmation: 'alpha',
        volumes: true,
        directory: true,
      })
    ).json()) as ProjectRemoveResult
    expect(body.via).toBe('iteration')
    expect(body.remainingCommands.some((command) => command.startsWith("rm -rf -- '/srv/dev/alpha'"))).toBe(true)
    expect(body.remainingCommands.some((command) => command.includes('down --volumes'))).toBe(true)
  })
})
