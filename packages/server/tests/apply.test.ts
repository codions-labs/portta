// Applying saved settings. The panel's whole part in it is starting one
// container the host created stopped, and reading back what that container did.
// See ADR 0026.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATEWAY } from './fixtures.ts'
import { type FakeContainer, makeApp, post } from './helpers.ts'

const APPLIER: FakeContainer = {
  id: 'gw-apply',
  name: 'portta-apply',
  image: 'codions-labs/portta-apply:0.2.0',
  state: 'created',
  // Created and never started: Docker writes a zero time, not an absent one.
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'apply', 'traefik.enable': 'false' },
}

const RUNNING: FakeContainer = { ...APPLIER, state: 'running', startedAt: '2026-01-01T10:00:00Z' }
const FAILED: FakeContainer = {
  ...APPLIER,
  state: 'exited',
  exitCode: 2,
  startedAt: '2026-01-01T10:00:00Z',
  finishedAt: '2026-01-01T10:00:40Z',
}
const SUCCEEDED: FakeContainer = { ...FAILED, exitCode: 0 }

const status = async (containers: FakeContainer[], query = '', env?: string) => {
  const { app, docker } = makeApp({ containers }, env === undefined ? {} : { envFile: envFile(env) })
  const response = await app.request(`/api/gateway/apply${query}`)
  expect(response.status).toBe(200)
  return { body: await response.json(), docker }
}

/** A saved .env on disk, which is where the host's decision actually lives. */
function envFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'portta-apply-')), '.env')
  writeFileSync(path, contents)
  return path
}

describe('GET /api/gateway/apply', () => {
  it('says so, and how to fix it, when the host has not enabled one', async () => {
    const { body } = await status(GATEWAY)
    expect(body).toMatchObject({ state: 'unavailable', available: false, unavailableReason: 'disabled' })
    // The reason has to name the setting *and* the command: turning the key on
    // is not enough on its own, and neither is running the command.
    expect(body.reason).toContain('PORTTA_APPLY')
    expect(body.applyCommand).toContain('bin/portta up')
  })

  // The three ways to have no applier have three different fixes; printing the
  // first one's advice for all of them would tell an operator to set a key they
  // had already set.
  it('distinguishes a host that enabled it but has not run the command', async () => {
    const { body } = await status(GATEWAY, '', 'PORTTA_APPLY=true\n')
    expect(body).toMatchObject({ available: false, unavailableReason: 'not-prepared' })
  })

  it("reports the host's own words when the host refuses", async () => {
    const { body } = await status(GATEWAY, '', 'PORTTA_APPLY=true\nPORTTA_WEB_EXPOSE=public\n')
    expect(body).toMatchObject({ available: false, unavailableReason: 'refused' })
    expect(body.reason).toContain('exposed publicly')
  })

  // Building the panel image stopped being a refusal: the build runs on the
  // host daemon through the mounted socket, not inside the applier.
  it('does not refuse a host that builds its own images', async () => {
    const { body } = await status(GATEWAY, '', 'PORTTA_APPLY=true\nPORTTA_WEB_DEV=true\n')
    expect(body).toMatchObject({ unavailableReason: 'not-prepared', buildsImages: true })
  })

  it('tells the browser when an apply carries a build, so it can wait longer', async () => {
    const { body } = await status([...GATEWAY, APPLIER], '', 'PORTTA_WEB_BUILD=true\n')
    expect(body).toMatchObject({ state: 'idle', available: true, buildsImages: true })
  })

  it('describes each pending change with the running and saved values', async () => {
    process.env.PORTTA_DOMAIN = 'localhost'
    try {
      const { body } = await status([...GATEWAY, APPLIER], '', 'PORTTA_DOMAIN=dev.test\n')
      expect(body.pendingKeys).toContain('PORTTA_DOMAIN')
      expect(body.pendingChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'PORTTA_DOMAIN', from: 'localhost', to: 'dev.test', secret: false }),
        ]),
      )
    } finally {
      delete process.env.PORTTA_DOMAIN
    }
  })

  it('reports a prepared applier that has never run as idle', async () => {
    const { body } = await status([...GATEWAY, APPLIER])
    expect(body).toMatchObject({ state: 'idle', available: true, exitCode: null, startedAt: null })
  })

  it('reports one that is running', async () => {
    const { body } = await status([...GATEWAY, RUNNING])
    expect(body).toMatchObject({ state: 'running', exitCode: null })
    expect(body.startedAt).toBeGreaterThan(0)
  })

  it('reports a successful apply', async () => {
    const { body } = await status([...GATEWAY, SUCCEEDED])
    expect(body).toMatchObject({ state: 'ok', exitCode: 0 })
    expect(body.finishedAt).toBeGreaterThan(0)
  })

  it('reports a failed one with its exit code, and its output unasked', async () => {
    // A failure the operator cannot read is a failure they cannot act on, so
    // the log tail comes along without having to be requested.
    const { body } = await status([...GATEWAY, FAILED])
    expect(body).toMatchObject({ state: 'failed', exitCode: 2 })
    expect(Array.isArray(body.logTail)).toBe(true)
  })

  it('does not read the log on a successful apply unless asked', async () => {
    const { docker } = await status([...GATEWAY, SUCCEEDED])
    expect(docker.calls.some((call) => call.method === 'logs')).toBe(false)

    const asked = await status([...GATEWAY, SUCCEEDED], '?logs=1')
    expect(asked.docker.calls.some((call) => call.method === 'logs')).toBe(true)
  })
})

describe('POST /api/gateway/apply', () => {
  it('starts the applier, and nothing else', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, APPLIER] })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(docker.calls).toContainEqual({ method: 'start', args: ['gw-apply'] })
    // Never a restart, never a create: the whole feature is one start.
    expect(docker.calls.some((call) => call.method === 'restart' || call.method === 'createBridge')).toBe(false)
  })

  it('refuses when the host has no applier, and hands back the host command', async () => {
    const { app, docker } = makeApp({ containers: GATEWAY })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(404)
    expect((await response.json()).hint).toContain('bin/portta up')
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })

  it('refuses a second apply while one is running', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, RUNNING] })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(409)
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })
})

describe('the generic container routes still refuse the applier', () => {
  // The dedicated route is the only door. Without this, the applier would be
  // startable through the same endpoint that starts any container, and the
  // 409/404 guards above could be walked around.
  it('POST /api/docker/containers/:id/start is refused', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, APPLIER] })
    const response = await post(app, '/api/docker/containers/gw-apply/start')
    expect(response.status).toBe(403)
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })
})
