// Taskflow through the panel: every contract route reaches the daemon at the
// same path, nothing reaches it without the permission, a scoped member reaches
// only the Taskflow Projects that are theirs, and streams and sockets pass.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Permission, type Principal, principalFor } from 'portta-auth-core'
import { apiContract } from 'portta-contracts/taskflow'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { createApp } from '../src/api/index.ts'
import type { AppDeps } from '../src/deps.ts'
import { taskflowDiagnostics, taskflowServerModule } from '../src/modules/taskflow/index.ts'
import { TASKFLOW_GLOBAL_ROUTES, TASKFLOW_ROUTES, type TaskflowContractKey } from '../src/modules/taskflow/routes.ts'
import { createUpgradeHandler } from '../src/realtime/ws/upgrade.ts'
import { databasePerFile, makeApp } from './helpers.ts'

const TOKEN = 'taskflow-host-token'
const tokenFile = join(mkdtempSync(join(tmpdir(), 'portta-taskflow-')), 'token')
writeFileSync(tokenFile, TOKEN)
const seededDatabase = databasePerFile()

let host: Server
let hostUrl: string
const received: string[] = []

beforeAll(async () => {
  const sockets = new WebSocketServer({ noServer: true })
  host = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://host')
    received.push(`${request.method} ${url.pathname}`)
    if (url.pathname === '/api/modules/taskflow/api/projects' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
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
    if (url.pathname.endsWith('/api/notifications/stream')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('event: notification\ndata: {"id":1}\n\n')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ method: request.method, path: url.pathname }))
  })
  host.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.send(`path:${new URL(request.url ?? '/', 'http://host').pathname}`)
      ws.on('message', (data) => ws.send(`echo:${data.toString()}`))
    })
  })
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve))
  hostUrl = `http://127.0.0.1:${(host.address() as { port: number }).port}`
})

afterAll(() => {
  host.closeAllConnections()
  host.close()
})

const sameOrigin = { origin: 'http://localhost', host: 'localhost' }

/** The panel with Taskflow mounted, a project `produto` whose repository lives where the `shop` prefix does, and one caller. */
async function panel(caller: Principal | ((projectId: number) => Principal)) {
  const seeded = await seededDatabase()
  const projectId = Number(seeded.ids.project)
  const principal = typeof caller === 'function' ? caller(projectId) : caller
  await seeded.database.repositories.update(seeded.ids.repository, { localPath: '/home/ana/code/shop' })
  const { app: _base, docker, ...deps } = makeApp({}, { hostUrl, hostTokenFile: tokenFile }, seeded.database)
  const composed: AppDeps = {
    ...deps,
    client: docker.client,
    auth: null,
    principals: { fromHeaders: async () => principal },
    modules: [taskflowServerModule],
  }
  return { app: createApp(composed), deps: composed }
}

/** A concrete path for a pattern, with a Project prefix when the route is scoped. */
function samplePath(key: TaskflowContractKey): string {
  const path = apiContract[key].path.replace(/:(\w+)/g, (_match, name: string) =>
    name === 'prefix' ? 'shop' : `sample-${name}`,
  )
  return TASKFLOW_GLOBAL_ROUTES.has(key) ? path : `/shop${path}`
}

describe('the Taskflow route table', () => {
  it('names every contract route, at the path the daemon serves it', () => {
    for (const key of Object.keys(apiContract) as TaskflowContractKey[]) {
      const route = TASKFLOW_ROUTES.find((candidate) => candidate.key === key)
      expect(route, key).toBeDefined()
      expect(route?.method).toBe(apiContract[key].method)
      expect(route?.pattern).toBe(
        TASKFLOW_GLOBAL_ROUTES.has(key) ? apiContract[key].path : `/:prefix${apiContract[key].path}`,
      )
    }
  })

  it('forwards each contract route to the same path on the daemon for somebody who holds everything', async () => {
    const { app } = await panel(principalFor())
    for (const key of Object.keys(apiContract) as TaskflowContractKey[]) {
      const path = samplePath(key)
      const { method } = apiContract[key]
      const response = await app.request(`/api/modules/taskflow${path}`, {
        method,
        headers: sameOrigin,
        ...(method === 'GET' ? {} : { body: '{}' }),
      })
      expect(response.status, `${method} ${path}`).toBe(200)
      expect(received.at(-1)).toBe(`${method} /api/modules/taskflow${path}`)
    }
  })

  it('never forwards the runtime hook the agents on the host report to', async () => {
    const { app } = await panel(principalFor())
    received.length = 0
    const response = await app.request('/api/modules/taskflow/shop/api/runtime/events', {
      method: 'POST',
      body: '{}',
      headers: sameOrigin,
    })
    expect(response.status).toBe(404)
    expect(received).toEqual([])
  })
})

describe('who may use Taskflow', () => {
  it('refuses a write the caller does not hold, before the daemon sees it', async () => {
    const viewer = principalFor({ permissions: new Set<Permission>(['worktree:read']) })
    const { app } = await panel(viewer)
    received.length = 0
    const refused = await app.request('/api/modules/taskflow/shop/api/worktrees', {
      method: 'POST',
      body: '{}',
      headers: sameOrigin,
    })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ hint: 'this needs worktree:write' })
    expect(received.filter((line) => line.startsWith('POST'))).toEqual([])
    expect((await app.request('/api/modules/taskflow/shop/api/worktrees')).status).toBe(200)
  })

  it('lets a Project member reach the Taskflow Project that is theirs, and not one nobody claimed', async () => {
    const { app } = await panel((projectId) =>
      principalFor({
        role: 'developer',
        permissions: new Set<Permission>(['worktree:read']),
        scope: new Set([projectId]),
      }),
    )
    expect((await app.request('/api/modules/taskflow/shop/api/worktrees')).status).toBe(200)
    expect((await app.request('/api/modules/taskflow/stray/api/worktrees')).status).toBe(403)
    expect((await app.request('/api/modules/taskflow/unknown/api/worktrees')).status).toBe(403)
    // The registry is not about one Project, so membership is not asked.
    expect((await app.request('/api/modules/taskflow/api/projects')).status).toBe(200)
  })

  it('passes a server-sent event stream through', async () => {
    const { app } = await panel(principalFor())
    const response = await app.request('/api/modules/taskflow/shop/api/notifications/stream')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe('event: notification\ndata: {"id":1}\n\n')
  })
})

describe('the Taskflow sockets', () => {
  let panelServer: Server
  let port: number
  let principal: Principal = principalFor()

  beforeAll(async () => {
    const { deps } = await panel(principalFor())
    const routes = taskflowServerModule.ws(deps)
    const upgrade = createUpgradeHandler({
      principals: { fromHeaders: async () => principal },
      routes,
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

  const connect = (path: string) =>
    new Promise<{ socket: WebSocket; first: string } | number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
      socket.once('message', (data) => resolve({ socket, first: data.toString() }))
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    })

  it('bridges a terminal and the agent chat to the same paths on the daemon', async () => {
    principal = principalFor()
    const terminal = await connect('/ws/modules/taskflow/shop/ws/feature%2Flogin')
    if (typeof terminal === 'number') throw new Error(`refused with ${terminal}`)
    expect(terminal.first).toBe('path:/ws/modules/taskflow/shop/ws/feature%2Flogin')
    const echoed = new Promise<string>((resolve) => terminal.socket.once('message', (data) => resolve(data.toString())))
    terminal.socket.send('ls\r')
    expect(await echoed).toBe('echo:ls\r')
    terminal.socket.close()

    const chat = await connect('/ws/modules/taskflow/shop/ws/agents/worktrees/login')
    if (typeof chat === 'number') throw new Error(`refused with ${chat}`)
    expect(chat.first).toBe('path:/ws/modules/taskflow/shop/ws/agents/worktrees/login')
    chat.socket.close()
  })

  it('refuses a terminal to somebody who may only chat, before the handshake', async () => {
    principal = principalFor({ permissions: new Set<Permission>(['agent:write']) })
    expect(await connect('/ws/modules/taskflow/shop/ws/login')).toBe(403)
    const chat = await connect('/ws/modules/taskflow/shop/ws/agents/worktrees/login')
    expect(typeof chat).not.toBe('number')
    if (typeof chat !== 'number') chat.socket.close()
  })
})

describe('the Taskflow doctor check', () => {
  it('passes when the daemon answers with this token, and says what is wrong when it does not', async () => {
    expect(await taskflowDiagnostics({ hostUrl, hostTokenFile: tokenFile })).toMatchObject([
      { id: 'taskflow-host', status: 'pass', params: { count: 2 } },
    ])
    expect(await taskflowDiagnostics({ hostUrl: null, hostTokenFile: tokenFile })).toMatchObject([{ status: 'fail' }])
    expect(await taskflowDiagnostics({ hostUrl: 'http://127.0.0.1:1', hostTokenFile: tokenFile })).toMatchObject([
      { status: 'fail' },
    ])
    const wrongToken = join(mkdtempSync(join(tmpdir(), 'portta-taskflow-')), 'token')
    writeFileSync(wrongToken, 'not-the-token')
    expect(await taskflowDiagnostics({ hostUrl, hostTokenFile: wrongToken })).toMatchObject([
      { status: 'fail', detail: 'the daemon refused the token the panel holds' },
    ])
  })
})
