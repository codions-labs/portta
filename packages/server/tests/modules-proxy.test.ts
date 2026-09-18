// The panel's way to a module on the host: what it forwards, what it adds, and
// what it refuses before the daemon ever sees a request.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Permission, type Principal, type PrincipalResolver, principalFor } from 'portta-auth-core'
import { defineModule } from 'portta-core/modules'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createApp } from '../src/api/index.ts'
import type { AppDeps } from '../src/deps.ts'
import type { ServerModule } from '../src/modules/index.ts'
import { createHostProxy, createHostWsRoute, type RoutePermissionTable } from '../src/modules/proxy.ts'
import { createUpgradeHandler } from '../src/realtime/ws/upgrade.ts'
import { makeApp } from './helpers.ts'

const TOKEN = 'host-token-for-the-suite'
const tokenFile = join(mkdtempSync(join(tmpdir(), 'portta-proxy-')), 'token')
writeFileSync(tokenFile, `${TOKEN}\n`)

let host: Server
let hostUrl: string
/** Lets the suite decide when the second event is written, to prove the first arrived alone. */
let releaseSecondEvent: () => void = () => undefined

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

beforeAll(async () => {
  const sockets = new WebSocketServer({ noServer: true })
  host = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://host')
    if (url.pathname === '/api/modules/fake/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write('data: one\n\n')
      await new Promise<void>((resolve) => {
        releaseSecondEvent = resolve
      })
      response.end('data: two\n\n')
      return
    }
    const body = request.method === 'GET' ? '' : await readBody(request)
    response.writeHead(201, {
      'content-type': 'application/json',
      'set-cookie': 'portta.session_token=stolen',
      'x-host': 'yes',
    })
    response.end(
      JSON.stringify({
        method: request.method,
        path: url.pathname,
        search: url.search,
        body,
        cookie: request.headers.cookie ?? null,
        actor: request.headers['x-portta-actor'] ?? null,
        actorKind: request.headers['x-portta-actor-kind'] ?? null,
      }),
    )
  })
  host.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.on('message', (data, binary) => ws.send(binary ? data : `echo:${data.toString()}`, { binary }))
    })
  })
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve))
  hostUrl = `http://127.0.0.1:${(host.address() as { port: number }).port}`
})

afterAll(() => {
  host.closeAllConnections()
  host.close()
})

const TABLE: RoutePermissionTable = [
  { method: 'GET', pattern: '/runs/:id', permission: 'gateway:read' },
  { method: 'POST', pattern: '/uploads/*', permission: 'gateway:operate' },
  { method: 'GET', pattern: '/events', permission: 'gateway:read' },
]

function panel(permissions?: Permission[], config: { hostUrl?: string | null } = {}) {
  const { app: _app, docker, ...deps } = makeApp()
  const hostConfig = { hostUrl: config.hostUrl === undefined ? hostUrl : config.hostUrl, hostTokenFile: tokenFile }
  const module: ServerModule = {
    manifest: defineModule({ id: 'fake', name: 'Fake', permissions: {}, activityKinds: [] }),
    routes: () => createHostProxy({ moduleId: 'fake', routes: TABLE, config: hostConfig }),
  }
  const principals: PrincipalResolver = permissions
    ? { fromHeaders: async () => principalFor({ permissions: new Set(permissions), actor: 'ana', actorKind: 'human' }) }
    : deps.principals
  const composed: AppDeps = { ...deps, client: docker.client, auth: null, principals, modules: [module] }
  return createApp(composed)
}

const sameOrigin = { origin: 'http://localhost', host: 'localhost' }

describe('the module proxy', () => {
  it('forwards a named route with the token, the query and who asked, and none of the caller credentials', async () => {
    const response = await panel(['gateway:read']).request('/api/modules/fake/runs/7?tail=10', {
      headers: { cookie: 'portta.session_token=mine', 'x-portta-actor': 'forged', authorization: 'Bearer ptt_caller' },
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-host')).toBe('yes')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toMatchObject({
      method: 'GET',
      path: '/api/modules/fake/runs/7',
      search: '?tail=10',
      cookie: null,
      actor: 'ana',
      actorKind: 'human',
    })
  })

  it('streams a request body through', async () => {
    const response = await panel(['gateway:operate']).request('/api/modules/fake/uploads/a/b.txt', {
      method: 'POST',
      body: 'x'.repeat(100_000),
      headers: { ...sameOrigin, 'content-type': 'application/octet-stream' },
    })
    const answer = (await response.json()) as { path: string; body: string }
    expect(answer.path).toBe('/api/modules/fake/uploads/a/b.txt')
    expect(answer.body).toHaveLength(100_000)
  })

  it('passes server-sent events through as they are written', async () => {
    const response = await panel(['gateway:read']).request('/api/modules/fake/events')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('the event stream had no body')
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe('data: one\n\n')
    releaseSecondEvent()
    let rest = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += decoder.decode(chunk.value)
    expect(rest).toBe('data: two\n\n')
  })

  it('refuses a route without its permission, and a route the table does not name', async () => {
    const denied = await panel(['gateway:read']).request('/api/modules/fake/uploads/x', {
      method: 'POST',
      body: 'x',
      headers: sameOrigin,
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ hint: 'this needs gateway:operate' })
    expect((await panel(['gateway:read', 'gateway:operate']).request('/api/modules/fake/secrets')).status).toBe(404)
    expect(
      (await panel(['gateway:read']).request('/api/modules/fake/runs/7', { method: 'DELETE', headers: sameOrigin }))
        .status,
    ).toBe(404)
  })

  it('says what is missing when the daemon is not configured or not there', async () => {
    const unconfigured = await panel(['gateway:read'], { hostUrl: null }).request('/api/modules/fake/runs/7')
    expect(unconfigured.status).toBe(503)
    expect(
      (await panel(['gateway:read'], { hostUrl: 'http://127.0.0.1:1' }).request('/api/modules/fake/runs/7')).status,
    ).toBe(502)
  })
})

describe('the module socket bridge', () => {
  let panelServer: Server
  let port: number
  let principal: Principal | null = principalFor()

  beforeAll(async () => {
    const route = createHostWsRoute({
      moduleId: 'fake',
      path: '/echo',
      permission: 'gateway:read',
      config: { hostUrl, hostTokenFile: tokenFile },
    })
    const upgrade = createUpgradeHandler({
      principals: { fromHeaders: async () => principal },
      routes: [route],
      server: new WebSocketServer({ noServer: true }),
    })
    panelServer = createServer((_request, response) => response.end())
    panelServer.on('upgrade', (request, socket, head) => void upgrade(request, socket, head))
    await new Promise<void>((resolve) => panelServer.listen(0, '127.0.0.1', resolve))
    port = (panelServer.address() as { port: number }).port
  })
  afterAll(() => {
    panelServer.closeAllConnections()
    panelServer.close()
  })

  const connect = () =>
    new Promise<WebSocket | number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/modules/fake/echo`)
      socket.once('open', () => resolve(socket))
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    })

  it('pipes text and binary frames to the host and back, including those sent before the host answered', async () => {
    principal = principalFor()
    const socket = await connect()
    if (typeof socket === 'number') throw new Error(`refused with ${socket}`)
    const received: (string | Buffer)[] = []
    const done = new Promise<void>((resolve) =>
      socket.on('message', (data, binary) => {
        received.push(binary ? Buffer.from(data as Buffer) : data.toString())
        if (received.length === 2) resolve()
      }),
    )
    socket.send('hello')
    socket.send(Buffer.from([1, 2, 3]), { binary: true })
    await done
    expect(received).toEqual(['echo:hello', Buffer.from([1, 2, 3])])
    socket.close()
  })

  it('is refused before the handshake for a principal without the permission', async () => {
    principal = principalFor({ permissions: new Set() })
    expect(await connect()).toBe(403)
  })
})
