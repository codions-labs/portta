import { spawn as spawnChild, spawnSync as spawnChildSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

let nextPort = 42_000 + Math.floor(Math.random() * 1_000)

function toHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

async function writeResponse(response: Response, target: import('node:http').ServerResponse): Promise<void> {
  target.writeHead(response.status, toHeaders(response.headers))
  target.end(Buffer.from(await response.arrayBuffer()))
}

function matchesRoute(pattern: string, pathname: string): boolean {
  const expected = pattern.split('/')
  const actual = pathname.split('/')
  return (
    expected.length === actual.length && expected.every((part, index) => part.startsWith(':') || part === actual[index])
  )
}

const nodeTestRuntime = {
  env: process.env,
  sleep: delay,
  async write(path: string, data: string | Uint8Array) {
    await mkdir(dirname(path), { recursive: true })
    return writeFile(path, data)
  },
  file(path: string) {
    return {
      get size() {
        return existsSync(path) ? statSync(path).size : 0
      },
      exists: async () => existsSync(path),
      text: () => readFile(path, 'utf8'),
      json: async () => JSON.parse(await readFile(path, 'utf8')) as unknown,
    }
  },
  spawnSync(command: string[], options: Record<string, unknown> = {}) {
    const [executable, ...args] = command
    const result = spawnChildSync(executable!, args, {
      cwd: options.cwd as string | undefined,
      env: options.env as NodeJS.ProcessEnv | undefined,
      input: options.stdin as string | Uint8Array | undefined,
      stdio: [options.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.stderr ?? Buffer.alloc(0),
    }
  },
  spawn(command: string[], options: Record<string, unknown> = {}) {
    const [executable, ...args] = command
    const child = spawnChild(executable!, args, {
      cwd: options.cwd as string | undefined,
      env: options.env as NodeJS.ProcessEnv | undefined,
      stdio: [options.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    return {
      stdin: child.stdin,
      stdout: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
      stderr: Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
      exited: new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? 1))),
      kill: (signal?: NodeJS.Signals) => child.kill(signal),
    }
  },
  serve(options: {
    hostname?: string
    port?: number
    fetch?: (request: Request) => Response | Promise<Response>
    routes?: Record<string, unknown>
  }) {
    const port = options.port && options.port > 0 ? options.port : nextPort++
    const hostname = options.hostname ?? '127.0.0.1'
    const server = createHttpServer(async (request, response) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${hostname}:${port}`}`)
      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : (Readable.toWeb(request) as ReadableStream<Uint8Array>)
      const webRequest = new Request(url, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body,
        duplex: body ? 'half' : undefined,
      } as RequestInit)
      let handler: unknown
      for (const [pattern, route] of Object.entries(options.routes ?? {})) {
        if (!matchesRoute(pattern, url.pathname)) continue
        handler = typeof route === 'function' ? route : (route as Record<string, unknown>)[request.method ?? 'GET']
        break
      }
      const result =
        typeof handler === 'function'
          ? await handler(webRequest)
          : options.fetch
            ? await options.fetch(webRequest)
            : new Response('Not Found', { status: 404 })
      await writeResponse(result, response)
    })
    server.listen(port, hostname)
    return {
      port,
      stop: (_force?: boolean) => server.close(),
    }
  },
  listen(options: {
    unix: string
    socket: { data: (socket: import('node:net').Socket & { flush: () => void }, chunk: Buffer) => void }
  }) {
    const server = createNetServer((socket) => {
      const compatibleSocket = Object.assign(socket, { flush: () => undefined })
      socket.on('data', (chunk) => options.socket.data(compatibleSocket, chunk))
    })
    server.listen(options.unix)
    return { stop: (_force?: boolean) => server.close() }
  },
}

Object.assign(globalThis, { nodeTest: nodeTestRuntime })

declare global {
  var nodeTest: typeof nodeTestRuntime
}
