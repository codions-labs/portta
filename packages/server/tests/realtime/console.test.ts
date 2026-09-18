import { createServer, type Server } from 'node:http'
import { Duplex } from 'node:stream'
import { type Principal, type PrincipalResolver, permissionsOf, principalFor } from 'portta-auth-core'
import { auditLog, seedMinimal } from 'portta-db'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { AppDeps } from '../../src/deps.ts'
import { consoleRoute } from '../../src/realtime/ws/console.ts'
import { createUpgradeHandler } from '../../src/realtime/ws/upgrade.ts'
import { DockerApiError } from '../../src/services/docker/client.ts'
import { FULL_HOST } from '../fixtures.ts'
import { databasePerFile, makeApp } from '../helpers.ts'

const servers: Server[] = []
const socketServers: WebSocketServer[] = []
const seededDatabase = databasePerFile()
afterEach(async () => {
  for (const sockets of socketServers.splice(0)) {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

class ConsoleStream extends Duplex {
  readonly input: Buffer[] = []
  override _read() {}
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.input.push(Buffer.from(chunk))
    callback()
  }
}

async function fixture(options: { missing?: boolean; attachDelay?: number; principal?: Principal | null } = {}) {
  const seeded = await seededDatabase({ empty: true })
  await seedMinimal(seeded.db)
  const panel = makeApp({ containers: FULL_HOST }, {}, seeded.database)
  const client = panel.docker.client as any
  const stream = new ConsoleStream()
  const shells: string[] = []
  const resizes: Array<[number, number]> = []
  client.createConsoleExec = async (_id: string, shell: string) => {
    shells.push(shell)
    return `exec${shell.endsWith('bash') ? 'bash' : 'sh'}`
  }
  client.attachConsoleExec = async (id: string) => {
    if (options.attachDelay) await new Promise((resolve) => setTimeout(resolve, options.attachDelay))
    if (options.missing || id === 'execbash') throw new DockerApiError(500, 'executable file not found in $PATH')
    queueMicrotask(() => stream.push(Buffer.from('$ ')))
    return stream
  }
  client.resizeConsoleExec = async (_id: string, cols: number, rows: number) => {
    resizes.push([cols, rows])
  }
  client.inspectConsoleExec = async () => ({
    ID: 'execsh',
    Running: !Buffer.concat(stream.input).includes(Buffer.from('exit\n')),
    ExitCode: null,
    Pid: 7,
  })

  const deps: AppDeps = {
    config: panel.config,
    client,
    cache: panel.cache,
    hub: panel.hub,
    verdict: panel.verdict,
    db: seeded.database,
    forge: panel.forge,
    security: panel.security,
    auth: null,
    principals: panel.principals,
  }
  const sockets = new WebSocketServer({ noServer: true })
  socketServers.push(sockets)
  const principal = Object.hasOwn(options, 'principal') ? (options.principal ?? null) : principalFor()
  const resolver: PrincipalResolver = { fromHeaders: async () => principal }
  const upgrade = createUpgradeHandler({ principals: resolver, routes: [consoleRoute(deps)], server: sockets })
  const server = createServer((_request, response) => response.end())
  servers.push(server)
  server.on('upgrade', (request, socket, head) => {
    void upgrade(request, socket, head)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { seeded, stream, shells, resizes, cache: panel.cache, port: (server.address() as { port: number }).port }
}

function connect(port: number, path: string): Promise<{ socket: WebSocket; control: any[]; output: Buffer[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    const control: any[] = []
    const output: Buffer[] = []
    socket.on('message', (data, binary) => {
      if (binary) {
        if (Array.isArray(data)) output.push(Buffer.concat(data))
        else if (data instanceof ArrayBuffer) output.push(Buffer.from(data))
        else output.push(Buffer.from(data))
      } else control.push(JSON.parse(String(data)))
      if (control.some((message) => message.kind === 'open' || message.kind === 'error'))
        resolve({ socket, control, output })
    })
    socket.on('unexpected-response', (_request, response) => {
      response.resume()
      reject(new Error(`handshake ${response.statusCode}`))
    })
    socket.on('error', reject)
    setTimeout(() => reject(new Error('console did not answer')), 2_000).unref()
  })
}

describe('container console WebSocket', () => {
  it.each([
    ['anonymous callers', null, 401],
    ['viewers', principalFor({ role: 'viewer', permissions: new Set(permissionsOf('viewer')) }), 403],
  ])('refuses %s before upgrading', async (_label, principal, status) => {
    const item = await fixture({ principal })
    await expect(connect(item.port, '/ws/environments/alpha/console?service=api')).rejects.toThrow(
      `handshake ${status}`,
    )
    expect(item.shells).toEqual([])
  })

  it('returns 404 before upgrading a nonexistent environment', async () => {
    const item = await fixture()
    await expect(connect(item.port, '/ws/environments/missing/console?service=api')).rejects.toThrow('handshake 404')
    expect(item.shells).toEqual([])
  })

  it('refuses a gateway-owned container before creating an exec', async () => {
    const item = await fixture()
    const snapshot = await item.cache.get()
    const environment = snapshot.environments.find((entry) => entry.name === 'alpha')
    const gateway = snapshot.containers.find((container) => container.id === 'gw-traefik')
    expect(environment && gateway).toBeTruthy()
    environment!.services.push({ ...gateway!, service: 'traefik' })
    item.cache.get = async () => snapshot

    const connected = await connect(item.port, '/ws/environments/alpha/console?service=traefik')
    expect(connected.control.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Portta component'),
    })
    expect(item.shells).toEqual([])
  })

  it('falls back to sh, carries bytes, resizes, audits and confirms teardown', async () => {
    const item = await fixture()
    const connected = await connect(item.port, '/ws/environments/alpha/console?service=api')
    expect(connected.control[0]).toMatchObject({ kind: 'open', environment: 'alpha', service: 'api', shell: '/bin/sh' })
    expect(item.shells).toEqual(['/bin/bash', '/bin/sh'])
    connected.socket.send(Buffer.from('echo ok\n'))
    connected.socket.send(JSON.stringify({ type: 'resize', cols: 97, rows: 31 }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(Buffer.concat(connected.output).toString()).toContain('$ ')
    expect(Buffer.concat(item.stream.input).toString()).toContain('echo ok')
    expect(item.resizes).toContainEqual([97, 31])
    connected.socket.close()
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(Buffer.concat(item.stream.input).includes(Buffer.from([3]))).toBe(true)
    expect(Buffer.concat(item.stream.input).toString()).toContain('exit\n')
    const entries = await item.seeded.db.select().from(auditLog)
    expect(entries.map((entry) => entry.action)).toEqual(['container.console_opened', 'container.console_closed'])
    expect(entries[1]?.metadata).toMatchObject({ teardownConfirmed: true, environment: 'alpha', service: 'api' })
  })

  it('reports an image with no supported shell instead of an empty terminal', async () => {
    const item = await fixture({ missing: true })
    const connected = await connect(item.port, '/ws/environments/alpha/console?service=api')
    expect(connected.control.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('no supported shell'),
    })
  })

  it('tears down an exec when the browser disconnects while Docker is attaching it', async () => {
    const item = await fixture({ attachDelay: 40 })
    const socket = new WebSocket(`ws://127.0.0.1:${item.port}/ws/environments/alpha/console?service=api&shell=sh`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    socket.close()
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(Buffer.concat(item.stream.input).includes(Buffer.from([3]))).toBe(true)
    expect(Buffer.concat(item.stream.input).toString()).toContain('exit\n')
  })

  it('closes the browser session and confirms teardown when the exec stream ends', async () => {
    const item = await fixture()
    const connected = await connect(item.port, '/ws/environments/alpha/console?service=api&shell=sh')
    const closed = new Promise<void>((resolve) => connected.socket.once('close', () => resolve()))
    item.stream.push(null)
    await closed
    await new Promise((resolve) => setTimeout(resolve, 140))
    expect(Buffer.concat(item.stream.input).toString()).toContain('exit\n')
    const entries = await item.seeded.db.select().from(auditLog)
    expect(entries.at(-1)).toMatchObject({
      action: 'container.console_closed',
      metadata: expect.objectContaining({ teardownConfirmed: true, reason: 'exec exited' }),
    })
  })
})
