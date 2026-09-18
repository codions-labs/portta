import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GATEWAY } from './fixtures.ts'
import { type FakeContainer, makeApp } from './helpers.ts'

const RUNNER: FakeContainer = {
  id: 'gw-runner',
  name: 'portta-runner',
  image: 'codions-labs/portta-apply:0.2.0',
  state: 'created',
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'runner', 'traefik.enable': 'false' },
}

const status = async (containers: FakeContainer[], env?: string) => {
  const { app } = makeApp({ containers }, env === undefined ? {} : { envFile: envFile(env) })
  const response = await app.request('/api/runner')
  expect(response.status).toBe(200)
  return await response.json()
}

function envFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'portta-runner-')), '.env')
  writeFileSync(path, contents)
  return path
}

describe('GET /api/runner', () => {
  it('says so, and how to fix it, when the host has not enabled one', async () => {
    const body = await status(GATEWAY)
    expect(body).toMatchObject({ state: 'unavailable', available: false, unavailableReason: 'disabled' })
    expect(body.reason).toContain('PORTTA_RUNNER')
    expect(body.prepareCommand).toContain('bin/portta up')
  })

  it('distinguishes a host that enabled it but has not run the command', async () => {
    const body = await status(GATEWAY, 'PORTTA_RUNNER=true\n')
    expect(body).toMatchObject({ available: false, unavailableReason: 'not-prepared' })
  })

  it("reports the host's own words when the host refuses", async () => {
    const body = await status(GATEWAY, 'PORTTA_RUNNER=true\nPORTTA_WEB_EXPOSE=public\n')
    expect(body).toMatchObject({ available: false, unavailableReason: 'refused' })
    expect(body.reason).toContain('exposed publicly')
  })

  it('is idle when the container exists and has never run', async () => {
    const body = await status([...GATEWAY, RUNNER], 'PORTTA_RUNNER=true\n')
    expect(body).toMatchObject({ state: 'idle', available: true, reason: null })
  })
})
