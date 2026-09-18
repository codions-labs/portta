// Who the host daemon answers, and what it mounts.

import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { defineModule } from 'portta-core/modules'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createHostApp } from '../src/app.ts'
import { hostListen } from '../src/config.ts'
import { type RunningHost, startHost } from '../src/main.ts'
import type { HostModule } from '../src/modules/index.ts'
import { hostTokenFile, readOrCreateToken } from '../src/token.ts'

const TOKEN = 'a-long-random-host-token'
const context = { stateDir: '/tmp/portta-host-test', env: {} }

const fake: HostModule = {
  manifest: defineModule({ id: 'fake', name: 'Fake', permissions: {}, activityKinds: [] }),
  routes: () => new Hono().get('/ping', (c) => c.json({ pong: true })),
  ws: () => [
    { path: '/ws/modules/fake/echo', handle: (socket) => socket.on('message', (data) => socket.send(data.toString())) },
  ],
}

const app = createHostApp({ token: TOKEN, modules: [fake], context })
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('the host API', () => {
  it('answers health without a token, and nothing else', async () => {
    expect((await app.request('/api/health')).status).toBe(200)
    expect((await app.request('/api/modules/fake/ping')).status).toBe(401)
    expect((await app.request('/api/modules/fake/ping', { headers: bearer('wrong') })).status).toBe(401)
    expect((await app.request('/api/nothing')).status).toBe(401)
  })

  it('mounts a module under /api/modules/<id> for a caller with the token', async () => {
    const response = await app.request('/api/modules/fake/ping', { headers: bearer(TOKEN) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pong: true })
    expect((await app.request('/api/modules/other/ping', { headers: bearer(TOKEN) })).status).toBe(404)
  })
})

describe('the host token', () => {
  it('is created once, owner-only, and read back unchanged', () => {
    const file = hostTokenFile(join(mkdtempSync(join(tmpdir(), 'portta-host-')), 'state', 'host'))
    const token = readOrCreateToken(file)
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readOrCreateToken(file)).toBe(token)
  })

  it('narrows a readable file and refuses an empty one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-host-'))
    const file = join(directory, 'token')
    writeFileSync(file, 'kept\n')
    chmodSync(file, 0o644)
    expect(readOrCreateToken(file)).toBe('kept')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    writeFileSync(file, '\n')
    expect(() => readOrCreateToken(file)).toThrow(/empty/)
  })
})

describe('where the daemon listens', () => {
  it('defaults to loopback on 5111 and refuses a port that is not one', () => {
    expect(hostListen({})).toEqual({ host: '127.0.0.1', port: 5111 })
    expect(hostListen({ PORTTA_HOST_BIND: '172.17.0.1', PORTTA_HOST_PORT: '6000' })).toEqual({
      host: '172.17.0.1',
      port: 6000,
    })
    expect(() => hostListen({ PORTTA_HOST_PORT: 'http' })).toThrow(/PORTTA_HOST_PORT/)
  })
})

describe('module sockets', () => {
  let running: RunningHost

  beforeAll(async () => {
    running = await startHost({ host: '127.0.0.1', port: 0, token: TOKEN, modules: [fake], context })
  })
  afterAll(async () => running.close())

  const open = (path: string, headers: Record<string, string>) =>
    new Promise<WebSocket | number>((resolve) => {
      const socket = new WebSocket(`${running.url.replace('http', 'ws')}${path}`, { headers })
      socket.once('open', () => resolve(socket))
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    })

  it('refuses a handshake without the token, and an unknown path with it', async () => {
    expect(await open('/ws/modules/fake/echo', {})).toBe(401)
    expect(await open('/ws/modules/fake/other', bearer(TOKEN))).toBe(404)
  })

  it('hands an authorised socket to the module', async () => {
    const socket = await open('/ws/modules/fake/echo', bearer(TOKEN))
    if (typeof socket === 'number') throw new Error(`refused with ${socket}`)
    const echoed = new Promise<string>((resolve) => socket.once('message', (data) => resolve(data.toString())))
    socket.send('hello')
    expect(await echoed).toBe('hello')
    socket.close()
  })

  it('serves HTTP on the same port', async () => {
    expect((await fetch(`${running.url}/api/health`)).status).toBe(200)
  })
})
