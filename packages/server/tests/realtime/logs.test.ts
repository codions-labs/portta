// Following a log, over a socket that was authorised before it existed.
//
// The route reads through the same Docker client the one-shot endpoint uses,
// on the endpoint the allowlist already permits. What is new is the framing —
// a chunk can carry half a line — and the closing, which has to happen from
// either side without leaving anything behind.

import { createServer, type Server } from 'node:http'
import { type Principal, type PrincipalResolver, principalFor } from 'portta-auth-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { AppDeps } from '../../src/deps.ts'
import { logStreamRoute } from '../../src/realtime/ws/logs.ts'
import { createUpgradeHandler } from '../../src/realtime/ws/upgrade.ts'
import { createLogDecoder } from '../../src/services/docker/client.ts'
import { FULL_HOST } from '../fixtures.ts'
import { makeApp } from '../helpers.ts'

let server: Server
let port: number
const principal: Principal | null = principalFor()

beforeAll(async () => {
  const panel = makeApp({ containers: FULL_HOST })
  const resolver: PrincipalResolver = { fromHeaders: async () => principal }
  const sockets = new WebSocketServer({ noServer: true })
  const upgrade = createUpgradeHandler({
    principals: resolver,
    routes: [logStreamRoute(panelDeps(panel))],
    server: sockets,
  })
  server = createServer((_request, response) => response.end())
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

/** The deps the route needs, from what `makeApp` built. */
function panelDeps(panel: ReturnType<typeof makeApp>): AppDeps {
  return {
    config: panel.config,
    client: panel.docker.client,
    cache: panel.cache,
    hub: panel.hub,
    verdict: panel.verdict,
    db: panel.db,
    forge: panel.forge,
    security: panel.security,
    auth: null,
    principals: panel.principals,
  }
}

/** Everything the socket said, until it closed. */
function collect(path: string): Promise<{ messages: Record<string, any>[]; code: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    const messages: Record<string, any>[] = []
    socket.on('message', (data) => messages.push(JSON.parse(String(data))))
    socket.on('close', (code) => resolve({ messages, code }))
    socket.on('unexpected-response', (_request, response) => {
      response.resume()
      reject(new Error(`handshake refused: ${response.statusCode}`))
    })
    setTimeout(() => socket.close(), 1_500)
  })
}

describe('the stream', () => {
  it('says what it opened, then delivers the lines', async () => {
    const { messages } = await collect('/ws/environments/alpha/logs?service=web')
    expect(messages[0]).toMatchObject({ kind: 'open', environment: 'alpha', service: 'web' })
    const lines = messages.filter((message) => message.kind === 'lines').flatMap((message) => message.lines)
    expect(lines.map((line: { text: string }) => line.text)).toContain('hello')
  })

  it('refuses parameters it cannot make sense of, rather than guessing', async () => {
    const { code } = await collect('/ws/environments/alpha/logs?tail=nonsense')
    expect(code).toBe(1008)
  })

  it('and a tail nobody should ask for', async () => {
    expect((await collect('/ws/environments/alpha/logs?tail=999999')).code).toBe(1008)
  })

  it('says which service does not exist, instead of streaming another one', async () => {
    const { messages, code } = await collect('/ws/environments/alpha/logs?service=nope')
    expect(code).toBe(1008)
    expect(messages.at(-1)).toMatchObject({ kind: 'error' })
  })
})

// A follower receives whatever the socket happened to deliver. `demultiplex` is
// written for a finished body and drops a partial tail; a stream cannot.
describe('framing a stream that arrives in pieces', () => {
  it('keeps a frame that has not finished arriving', () => {
    const decode = createLogDecoder(true)
    const frame = (text: string, stream = 1) => {
      const payload = Buffer.from(text, 'utf8')
      const header = Buffer.alloc(8)
      header[0] = stream
      header.writeUInt32BE(payload.length, 4)
      return Buffer.concat([header, payload])
    }
    const whole = frame('2026-01-01T00:00:01Z first\n')
    // Split in the middle of the header, then in the middle of the payload.
    expect(decode(whole.subarray(0, 3))).toEqual([])
    expect(decode(whole.subarray(3, 12))).toEqual([])
    expect(decode(whole.subarray(12)).map((line) => line.text)).toEqual(['first'])
  })

  it('keeps a line that has no newline yet, on a raw stream', () => {
    const decode = createLogDecoder(false)
    expect(decode(new TextEncoder().encode('2026-01-01T00:00:01Z par'))).toEqual([])
    expect(decode(new TextEncoder().encode('tial\n')).map((line) => line.text)).toEqual(['partial'])
  })

  it('tells stderr from stdout', () => {
    const decode = createLogDecoder(true)
    const header = Buffer.alloc(8)
    header[0] = 2
    const payload = Buffer.from('2026-01-01T00:00:01Z boom\n', 'utf8')
    header.writeUInt32BE(payload.length, 4)
    expect(decode(Buffer.concat([header, payload]))[0]?.stream).toBe('stderr')
  })
})
