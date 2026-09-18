// Who gets a socket, and what happens to everybody else.
//
// The decision is made while the request is still HTTP, so it is made with the
// same principal resolver every route uses. What this suite is really about is
// the other half: a refused handshake has to be answered *and closed*. A socket
// left open is a client waiting forever for a server that already decided.

import { createServer, type Server } from 'node:http'
import { type Principal, type PrincipalResolver, principalFor } from 'portta-auth-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createUpgradeHandler, matchPath, NotFound, type WsRoute } from '../../src/realtime/ws/upgrade.ts'

let server: Server
let port: number
let principal: Principal | null = null
interface Handled {
  params: Record<string, string>
  url: URL
}
let handled: Handled | null = null
/** Read through a function: the route's closure writes it, and control flow cannot see that. */
const lastHandled = (): Handled | null => handled

const resolver: PrincipalResolver = { fromHeaders: async () => principal }

const route: WsRoute = {
  path: '/ws/environments/:name/logs',
  permission: 'logs:read',
  async scopeOf(params) {
    if (params.name === 'missing') throw new NotFound("no environment 'missing'")
    return { projectId: params.name === 'orphan' ? null : 1 }
  },
  handle(socket, context) {
    handled = { params: context.params, url: context.url }
    socket.send('ok')
    socket.close()
  },
}

beforeAll(async () => {
  const sockets = new WebSocketServer({ noServer: true })
  const upgrade = createUpgradeHandler({ principals: resolver, routes: [route], server: sockets })
  server = createServer((_request, response) => response.end('http'))
  // One listener, for every path. Several would each receive every upgrade and
  // leave the socket hanging unless all of them agreed who cleans up.
  server.on('upgrade', (request, socket, head) => {
    void upgrade(request, socket, head).then((mine) => {
      if (!mine) socket.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  port = (server.address() as { port: number }).port
})

afterAll(() => {
  server.close()
})

/** The handshake, as far as it gets: the status line, or the socket closing. */
async function handshake(path: string, origin?: string): Promise<{ status: number | null; closed: boolean }> {
  const { WebSocket } = await import('ws')
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: origin ? { origin } : undefined,
    })
    let status: number | null = null
    socket.on('unexpected-response', (_request, response) => {
      status = response.statusCode ?? null
      response.resume()
      resolve({ status, closed: true })
    })
    socket.on('open', () => resolve({ status: 101, closed: false }))
    socket.on('error', () => resolve({ status, closed: true }))
    socket.on('close', () => resolve({ status, closed: true }))
  })
}

describe('a handshake nobody may make', () => {
  it('is 401 without a principal, whatever the path is', async () => {
    principal = null
    expect((await handshake('/ws/environments/shop/logs')).status).toBe(401)
    // Before the route is matched: an anonymous caller learns that it has to
    // sign in, and not which paths exist.
    expect((await handshake('/ws/nothing/here')).status).toBe(401)
  })

  it('is 404 for a path no route claims', async () => {
    principal = principalFor()
    expect((await handshake('/ws/nothing/here')).status).toBe(404)
  })

  it('is 404 when the route matched but the thing does not exist', async () => {
    principal = principalFor()
    expect((await handshake('/ws/environments/missing/logs')).status).toBe(404)
  })

  it('is 403 for a principal without the permission', async () => {
    principal = principalFor({ permissions: new Set() })
    expect((await handshake('/ws/environments/shop/logs')).status).toBe(403)
  })

  it('is 403 for a browser on another origin before it becomes a socket', async () => {
    principal = principalFor({ permissions: new Set(['logs:read']) })
    expect((await handshake('/ws/environments/shop/logs', 'https://attacker.example')).status).toBe(403)
    expect((await handshake('/ws/environments/shop/logs', `http://127.0.0.1:${port}`)).status).toBe(101)
  })

  it('is 403 for a Project this principal does not reach', async () => {
    principal = principalFor({ permissions: new Set(['logs:read']), scope: new Set([2]) })
    expect((await handshake('/ws/environments/shop/logs')).status).toBe(403)
  })

  // An environment no Project adopted belongs to nobody, and is for the people
  // who see everything.
  it('is 403 on an unadopted environment for anybody but scope: all', async () => {
    principal = principalFor({ permissions: new Set(['logs:read']), scope: new Set([1]) })
    expect((await handshake('/ws/environments/orphan/logs')).status).toBe(403)
    principal = principalFor({ permissions: new Set(['logs:read']) })
    expect((await handshake('/ws/environments/orphan/logs')).status).toBe(101)
  })

  it('and every refusal closes the socket rather than leaving it open', async () => {
    principal = null
    expect((await handshake('/ws/environments/shop/logs')).closed).toBe(true)
  })
})

describe('a handshake that is allowed', () => {
  it('reaches the route with its parameters and its query', async () => {
    principal = principalFor({ permissions: new Set(['logs:read']) })
    handled = null
    expect((await handshake('/ws/environments/shop/logs?service=web&tail=50')).status).toBe(101)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(lastHandled()?.params).toEqual({ name: 'shop' })
    expect(lastHandled()?.url.searchParams.get('service')).toBe('web')
  })
})

describe('matching a path', () => {
  it('binds the named segments and refuses everything else', () => {
    expect(matchPath('/ws/environments/:name/logs', '/ws/environments/shop/logs')).toEqual({ name: 'shop' })
    expect(matchPath('/ws/environments/:name/logs', '/ws/environments/shop/logs/extra')).toBeNull()
    expect(matchPath('/ws/environments/:name/logs', '/ws/environments//logs')).toBeNull()
    expect(matchPath('/ws/environments/:name/logs', '/ws/other/shop/logs')).toBeNull()
    // A name that had to be escaped comes back as it was written.
    expect(matchPath('/ws/environments/:name/logs', '/ws/environments/a%2Fb/logs')).toEqual({ name: 'a/b' })
  })
})
