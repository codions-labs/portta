import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { permissionsOf } from 'portta-auth-core'
import { readHttpAccessStore } from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_A } from './fixtures.ts'
import { type FakeContainer, makeApp, post } from './helpers.ts'

const MAILPIT: FakeContainer = {
  id: 'a-mailpit',
  name: 'alpha-mailpit-1',
  image: 'axllent/mailpit:latest',
  networks: ['alpha_default'],
  exposed: [1025, 8025],
  labels: { 'com.docker.compose.project': 'alpha', 'com.docker.compose.service': 'mailpit', 'traefik.enable': 'false' },
}
const RUNNER: FakeContainer = {
  id: 'gw-runner',
  name: 'portta-runner',
  image: 'portta-apply:test',
  state: 'created',
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'runner', 'traefik.enable': 'false' },
}
const endpoint = '/api/environments/alpha/services/mailpit/http-integration'

function panel(options: { integrated?: boolean; runner?: boolean; failStart?: boolean; public?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-http-integration-'))
  const envFile = join(directory, '.env')
  writeFileSync(envFile, options.public ? 'PORTTA_RUNNER=true\nPORTTA_RUNNER_PUBLIC=true\n' : 'PORTTA_RUNNER=true\n')
  return makeApp(
    {
      containers: [
        ...PROJECT_A,
        { ...MAILPIT, networks: options.integrated ? ['portta', 'alpha_default'] : MAILPIT.networks },
        ...(options.runner === false ? [] : [RUNNER]),
      ],
      ...(options.failStart ? { fail: { start: ['gw-runner'] } } : {}),
    },
    {
      dynamicDir: join(directory, 'dynamic'),
      runnerDir: join(directory, 'runner'),
      envFile,
      ...(options.public
        ? { profile: 'remote-public', tlsEnabled: true, webExpose: 'domain', authMode: 'required' }
        : {}),
    },
  )
}

afterEach(() => vi.restoreAllMocks())

describe('preparing HTTP access for one service', () => {
  it('dispatches a correlated single-service request and creates no hostname', async () => {
    const instance = panel()
    const response = await post(instance.app, endpoint, { alias: 'mail', port: 8025 })
    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toMatchObject({ ready: false, requestId: expect.any(String) })
    expect(JSON.parse(readFileSync(join(instance.config.runnerDir, 'request.json'), 'utf8'))).toMatchObject({
      verb: 'integrate-http',
      project: 'alpha',
      service: 'mailpit',
      port: 8025,
      requestId: body.requestId,
    })
    expect(readHttpAccessStore(join(instance.config.runnerDir, 'http-access.json')).attachments).toEqual([
      { project: 'alpha', service: 'mailpit' },
    ])
    expect(instance.docker.calls.filter((call) => call.method === 'start').map((call) => call.args[0])).toEqual([
      'gw-runner',
    ])
    expect(existsSync(join(instance.config.dynamicDir, 'portta-aliases.yaml'))).toBe(false)
    const retry = await post(instance.app, endpoint, { alias: 'mail', port: 8025 })
    expect(await retry.json()).toEqual(body)
    expect(instance.docker.calls.filter((call) => call.method === 'start')).toHaveLength(1)
    const operation = await (await instance.app.request(`${endpoint}/${body.requestId}`)).json()
    expect(operation).toMatchObject({ state: 'pending', project: 'alpha', service: 'mailpit', port: 8025 })
  })

  it('does not recreate an already integrated container or require a runner for it', async () => {
    const instance = panel({ integrated: true, runner: false })
    const response = await post(instance.app, endpoint, { alias: 'mail', port: 8025 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ready: true, requestId: null })
    expect(instance.docker.calls.filter((call) => call.method === 'start')).toEqual([])
  })

  it('refuses SMTP and missing runner before recording an attachment', async () => {
    const instance = panel({ runner: false })
    expect((await post(instance.app, endpoint, { alias: 'smtp', port: 1025 })).status).toBe(400)
    expect((await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).status).toBe(409)
    expect(existsSync(join(instance.config.runnerDir, 'http-access.json'))).toBe(false)
  })

  it('rolls back a new attachment if the runner cannot be started', async () => {
    const instance = panel({ failStart: true })
    const response = await post(instance.app, endpoint, { alias: 'mail', port: 8025 })
    expect(response.status).toBe(500)
    expect(readHttpAccessStore(join(instance.config.runnerDir, 'http-access.json')).attachments).toEqual([])
    expect(existsSync(join(instance.config.dynamicDir, 'portta-aliases.yaml'))).toBe(false)
  })

  it('keeps an unrelated attachment written while starting the runner fails', async () => {
    const instance = panel()
    const path = join(instance.config.runnerDir, 'http-access.json')
    vi.spyOn(instance.docker.client, 'start').mockImplementation(async () => {
      const current = readHttpAccessStore(path)
      writeFileSync(
        path,
        JSON.stringify({ ...current, attachments: [...current.attachments, { project: 'beta', service: 'admin' }] }),
      )
      throw new Error('start failed')
    })
    expect((await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).status).toBe(500)
    expect(readHttpAccessStore(path).attachments).toEqual([{ project: 'beta', service: 'admin' }])
  })

  it('does not trust another request or an ok result without a fresh running gateway target', async () => {
    const instance = panel()
    const start = await (await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).json()
    const path = join(instance.config.runnerDir, 'http-operations', `${start.requestId}.json`)
    const operation = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...operation, state: 'ok' }))
    const result = await (await instance.app.request(`${endpoint}/${start.requestId}`)).json()
    expect(result).toMatchObject({ state: 'failed', error: expect.stringContaining('gateway network') })
    const other = await instance.app.request(`/api/environments/alpha/services/web/http-integration/${start.requestId}`)
    expect(other.status).toBe(404)
  })

  it('fails a stale operation when the runner was used for something else and permits a new retry', async () => {
    const instance = panel()
    const start = await (await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).json()
    writeFileSync(join(instance.config.runnerDir, 'request.json'), JSON.stringify({ verb: 'build', project: 'alpha' }))
    const result = await (await instance.app.request(`${endpoint}/${start.requestId}`)).json()
    expect(result).toMatchObject({ state: 'failed', error: expect.any(String) })
    const retry = await post(instance.app, endpoint, { alias: 'mail', port: 8025 })
    expect(retry.status).toBe(202)
    expect((await retry.json()).requestId).not.toBe(start.requestId)
  })

  it('requires protect and operate permissions before any write', async () => {
    const instance = panel({ public: true })
    const principal = await instance.principals.fromHeaders(new Headers())
    vi.spyOn(instance.principals, 'fromHeaders').mockResolvedValue({
      ...principal!,
      permissions: permissionsOf('developer'),
    })
    expect((await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).status).toBe(403)
    expect(existsSync(instance.config.runnerDir)).toBe(false)
    vi.spyOn(instance.principals, 'fromHeaders').mockResolvedValue({
      ...principal!,
      permissions: new Set(['environment:settings']),
    })
    expect((await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).status).toBe(403)
    expect(existsSync(instance.config.runnerDir)).toBe(false)
  })

  it('rejects operation path traversal and another project scope', async () => {
    const instance = panel()
    const principal = await instance.principals.fromHeaders(new Headers())
    vi.spyOn(instance.principals, 'fromHeaders').mockResolvedValue({ ...principal!, scope: new Set() })
    expect((await post(instance.app, endpoint, { alias: 'mail', port: 8025 })).status).toBe(403)
    expect(existsSync(instance.config.runnerDir)).toBe(false)
    vi.restoreAllMocks()
    expect((await instance.app.request(`${endpoint}/not-a-uuid`)).status).toBe(400)
  })
})
