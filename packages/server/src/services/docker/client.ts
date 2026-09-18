// A very small Docker Engine API client, pinned to Engine API v1.43 (Docker
// Engine 24, the project's minimum supported version). The reasons for using
// this narrow client instead of a general Docker SDK are recorded in
// docs/development/adr/0017-no-docker-sdk.md.
//
// It never opens the Docker socket: it talks to the panel's own socket proxy
// over the internal control network, and every request passes through the
// allowlist first. There is deliberately no generic "run this Docker call"
// method, and no way for a route handler to reach an endpoint the allowlist
// does not name.

import { request as httpRequest } from 'node:http'
import type { Duplex } from 'node:stream'
import { assertAllowed, assertValidId } from './allowlist.ts'
import type {
  DockerContainerInspect,
  DockerContainerListItem,
  DockerEvent,
  DockerInfo,
  DockerNetwork,
  DockerStats,
  DockerVersion,
} from './types.ts'

export const DOCKER_ENGINE_API_VERSION = 'v1.43'

export class DockerApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'DockerApiError'
    this.status = status
  }
}

export interface LogLine {
  stream: 'stdout' | 'stderr'
  timestamp: string | null
  text: string
}

export interface BridgeSpec {
  name: string
  image: string
  network: string
  targetService: string
  targetPort: number
  bindIp: string
  hostPort: number | null
  labels: Record<string, string>
  ttlSeconds: number | null
}

export interface DockerExecInspect {
  ID: string
  Running: boolean
  ExitCode: number | null
  Pid: number
}

export class DockerClient {
  private base: string

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '')
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string | undefined>
      body?: unknown
      signal?: AbortSignal
    } = {},
  ): Promise<Response> {
    assertAllowed(method, path)

    // The only write that carries a query today is the removal, and it must
    // never ask Docker to take volumes or links with it.
    if (method === 'DELETE') {
      const q = options.query ?? {}
      if (q.v === '1' || q.v === 'true' || q.link === '1' || q.link === 'true') {
        throw new Error('the panel never removes volumes or links alongside a container')
      }
    }

    const url = new URL(`${this.base}/${DOCKER_ENGINE_API_VERSION}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value)
    }

    const init: RequestInit = { method, signal: options.signal ?? null }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body)
      init.headers = { 'content-type': 'application/json' }
    }

    let response: Response
    try {
      response = await fetch(url, init)
    } catch (cause) {
      throw new DockerApiError(503, `cannot reach the Docker socket proxy at ${this.base}: ${String(cause)}`)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let message = text
      try {
        const parsed = JSON.parse(text) as { message?: string }
        if (parsed.message) message = parsed.message
      } catch {
        /* the proxy answers with plain HTML when it denies a request */
      }
      throw new DockerApiError(response.status, message || response.statusText)
    }
    return response
  }

  private async json<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string | undefined>
      body?: unknown
    } = {},
  ): Promise<T> {
    const response = await this.request(method, path, options)
    return (await response.json()) as T
  }

  async ping(): Promise<boolean> {
    try {
      await this.request('GET', '/_ping')
      return true
    } catch {
      return false
    }
  }

  version(): Promise<DockerVersion> {
    return this.json<DockerVersion>('GET', '/version')
  }

  info(): Promise<DockerInfo> {
    return this.json<DockerInfo>('GET', '/info')
  }

  listContainers(all = true): Promise<DockerContainerListItem[]> {
    return this.json<DockerContainerListItem[]>('GET', '/containers/json', {
      query: { all: all ? '1' : '0' },
    })
  }

  inspect(id: string): Promise<DockerContainerInspect> {
    return this.json<DockerContainerInspect>('GET', `/containers/${assertValidId(id)}/json`)
  }

  listNetworks(): Promise<DockerNetwork[]> {
    return this.json<DockerNetwork[]>('GET', '/networks')
  }

  inspectNetwork(id: string): Promise<DockerNetwork> {
    return this.json<DockerNetwork>('GET', `/networks/${assertValidId(id)}`)
  }

  async start(id: string): Promise<void> {
    await this.request('POST', `/containers/${assertValidId(id)}/start`)
  }

  async stop(id: string, timeoutSeconds = 10): Promise<void> {
    await this.request('POST', `/containers/${assertValidId(id)}/stop`, {
      query: { t: String(timeoutSeconds) },
    })
  }

  async restart(id: string, timeoutSeconds = 10): Promise<void> {
    await this.request('POST', `/containers/${assertValidId(id)}/restart`, {
      query: { t: String(timeoutSeconds) },
    })
  }

  /** Create one interactive, non-privileged exec with a server-chosen shell. */
  async createConsoleExec(id: string, shell: '/bin/bash' | '/bin/sh'): Promise<string> {
    const created = await this.json<{ Id: string }>('POST', `/containers/${assertValidId(id)}/exec`, {
      body: {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: [shell],
        Privileged: false,
      },
    })
    return assertValidId(created.Id)
  }

  /**
   * Attach the raw TTY stream. Fetch cannot expose Docker's HTTP hijack, so
   * this one typed call uses node:http and still crosses the same allowlist and
   * socket proxy as every other Docker operation.
   */
  attachConsoleExec(id: string): Promise<Duplex> {
    const path = `/exec/${assertValidId(id)}/start`
    assertAllowed('POST', path)
    const target = new URL(`${this.base}/${DOCKER_ENGINE_API_VERSION}${path}`)
    if (target.protocol !== 'http:')
      throw new DockerApiError(503, 'the Docker socket proxy must use HTTP on its private network')
    const payload = Buffer.from(JSON.stringify({ Detach: false, Tty: true }))
    return new Promise((resolve, reject) => {
      const request = httpRequest(target, {
        method: 'POST',
        headers: {
          connection: 'Upgrade',
          upgrade: 'tcp',
          'content-type': 'application/json',
          'content-length': payload.length,
        },
      })
      request.on('upgrade', (response, socket, head) => {
        if (response.statusCode !== 101) {
          socket.destroy()
          reject(new DockerApiError(response.statusCode ?? 502, 'Docker refused the console stream'))
          return
        }
        if (head.length > 0) socket.unshift(head)
        resolve(socket)
      })
      request.on('response', (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          if (chunks.reduce((size, item) => size + item.length, 0) < 32 * 1024) chunks.push(chunk)
        })
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let message = text
          try {
            message = (JSON.parse(text) as { message?: string }).message ?? text
          } catch {
            /* plain proxy response */
          }
          reject(new DockerApiError(response.statusCode ?? 502, message || 'Docker refused the console stream'))
        })
      })
      request.on('error', (cause) =>
        reject(new DockerApiError(503, `cannot reach the Docker socket proxy: ${String(cause)}`)),
      )
      request.end(payload)
    })
  }

  async resizeConsoleExec(id: string, cols: number, rows: number): Promise<void> {
    await this.request('POST', `/exec/${assertValidId(id)}/resize`, {
      query: { w: String(cols), h: String(rows) },
    })
  }

  inspectConsoleExec(id: string): Promise<DockerExecInspect> {
    return this.json<DockerExecInspect>('GET', `/exec/${assertValidId(id)}/json`)
  }

  /**
   * Removes a container and nothing else: `v=0` keeps anonymous volumes,
   * `link=0` keeps network links. Named volumes were never in scope.
   */
  async remove(id: string, force = false): Promise<void> {
    await this.request('DELETE', `/containers/${assertValidId(id)}`, {
      query: { v: '0', link: '0', force: force ? '1' : '0' },
    })
  }

  async stats(id: string): Promise<DockerStats> {
    return this.json<DockerStats>('GET', `/containers/${assertValidId(id)}/stats`, {
      query: { stream: 'false', 'one-shot': 'true' },
    })
  }

  async logs(id: string, options: { tail?: number; since?: number; timestamps?: boolean } = {}): Promise<LogLine[]> {
    const response = await this.request('GET', `/containers/${assertValidId(id)}/logs`, {
      query: {
        stdout: '1',
        stderr: '1',
        timestamps: options.timestamps === false ? '0' : '1',
        tail: String(options.tail ?? 200),
        since: options.since === undefined ? undefined : String(options.since),
      },
    })
    const buffer = Buffer.from(await response.arrayBuffer())
    const multiplexed = (response.headers.get('content-type') ?? '').includes('multiplexed')
    return multiplexed ? demultiplex(buffer) : splitRaw(buffer)
  }

  /**
   * The same logs, as they arrive.
   *
   * `follow=1` on the endpoint the allowlist already permits: the query string
   * is not part of what the allowlist matches, because a query cannot reach an
   * endpoint the panel is not allowed to call. The caller owns the stream and
   * the `AbortSignal` that ends it — Docker holds the connection open until
   * one side closes, and a follower nobody aborts is a socket nobody closes.
   */
  async followLogs(
    id: string,
    options: { tail?: number; since?: number; signal: AbortSignal },
  ): Promise<{ stream: ReadableStream<Uint8Array>; multiplexed: boolean }> {
    const response = await this.request('GET', `/containers/${assertValidId(id)}/logs`, {
      signal: options.signal,
      query: {
        stdout: '1',
        stderr: '1',
        timestamps: '1',
        follow: '1',
        tail: String(options.tail ?? 200),
        since: options.since === undefined ? undefined : String(options.since),
      },
    })
    if (!response.body) throw new Error('the Docker API answered the log stream with no body')
    return {
      stream: response.body,
      multiplexed: (response.headers.get('content-type') ?? '').includes('multiplexed'),
    }
  }

  /**
   * The one call that creates something. The shape is fixed here: a socat
   * forwarder on one network, with no binds, no privileges and no environment.
   * Nothing from the request body reaches Docker unchecked.
   */
  async createBridge(spec: BridgeSpec): Promise<string> {
    const target = `${spec.targetService}:${spec.targetPort}`
    const listen = `TCP-LISTEN:${spec.targetPort},fork,reuseaddr`
    const exposed = `${spec.targetPort}/tcp`

    const body: Record<string, unknown> = {
      Image: spec.image,
      Labels: spec.labels,
      ExposedPorts: { [exposed]: {} },
      HostConfig: {
        PortBindings: {
          [exposed]: [
            {
              HostIp: spec.bindIp,
              HostPort: spec.hostPort ? String(spec.hostPort) : '',
            },
          ],
        },
        RestartPolicy: { Name: 'no' },
        // Explicit emptiness: this container gets no host filesystem, no extra
        // capabilities and no privileged mode, whatever a caller asks for.
        Binds: [],
        Mounts: [],
        Privileged: false,
        CapAdd: [],
        AutoRemove: false,
      },
      NetworkingConfig: { EndpointsConfig: { [spec.network]: {} } },
    }

    if (spec.ttlSeconds === null) {
      body.Cmd = [listen, `TCP:${target}`]
    } else {
      // Mirrors `portta access open --ttl`: busybox timeout is in the
      // image, and exec keeps socat as PID 1 so it still gets the signal.
      body.Entrypoint = ['sh']
      body.Cmd = ['-c', `exec timeout -s TERM ${spec.ttlSeconds} socat ${listen} TCP:${target}`]
    }

    const created = await this.json<{ Id: string; Warnings?: string[] }>('POST', '/containers/create', {
      query: { name: spec.name },
      body,
    })
    await this.start(created.Id)
    return created.Id
  }

  /** Streams Docker events until the signal aborts. */
  async *events(signal: AbortSignal): AsyncGenerator<DockerEvent> {
    const response = await this.request('GET', '/events', { signal })
    if (!response.body) return
    const decoder = new TextDecoder()
    let buffered = ''
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffered += decoder.decode(chunk, { stream: true })
      let newline = buffered.indexOf('\n')
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line) {
          try {
            yield JSON.parse(line) as DockerEvent
          } catch {
            /* a partial frame is not worth failing the stream over */
          }
        }
        newline = buffered.indexOf('\n')
      }
    }
  }
}

/**
 * Docker multiplexes stdout and stderr into 8-byte-framed chunks whenever the
 * container has no TTY.
 */
export function demultiplex(buffer: Buffer): LogLine[] {
  const lines: LogLine[] = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset]
    const size = buffer.readUInt32BE(offset + 4)
    const start = offset + 8
    const end = Math.min(start + size, buffer.length)
    const payload = buffer.subarray(start, end).toString('utf8')
    const stream: 'stdout' | 'stderr' = streamType === 2 ? 'stderr' : 'stdout'
    for (const line of payload.split('\n')) {
      if (line !== '') lines.push(parseLine(line, stream))
    }
    // A zero-length frame is legal: `end` already accounts for the 8-byte
    // header, so the loop always advances.
    offset = end
  }
  return lines
}

/**
 * The same framing, one chunk at a time.
 *
 * A follower receives whatever the socket happened to deliver: half a frame,
 * three frames, a line with no newline yet. `demultiplex` is written for a
 * finished body and would drop every partial tail, so a stream needs a decoder
 * that keeps what it could not finish and starts the next chunk with it.
 */
export function createLogDecoder(multiplexed: boolean): (chunk: Uint8Array) => LogLine[] {
  let rest = Buffer.alloc(0)

  if (!multiplexed) {
    return (chunk) => {
      rest = Buffer.concat([rest, Buffer.from(chunk)])
      const text = rest.toString('utf8')
      const parts = text.split('\n')
      // The last piece has no newline yet: it is the beginning of a line the
      // socket has not finished delivering.
      rest = Buffer.from(parts.pop() ?? '', 'utf8')
      return parts.filter((line) => line !== '').map((line) => parseLine(line, 'stdout'))
    }
  }

  return (chunk) => {
    rest = Buffer.concat([rest, Buffer.from(chunk)])
    const lines: LogLine[] = []
    let offset = 0
    while (offset + 8 <= rest.length) {
      const streamType = rest[offset]
      const size = rest.readUInt32BE(offset + 4)
      const start = offset + 8
      // The frame has not arrived in full. Keep everything from its header on.
      if (start + size > rest.length) break
      const payload = rest.subarray(start, start + size).toString('utf8')
      const stream: 'stdout' | 'stderr' = streamType === 2 ? 'stderr' : 'stdout'
      for (const line of payload.split('\n')) {
        if (line !== '') lines.push(parseLine(line, stream))
      }
      offset = start + size
    }
    rest = rest.subarray(offset)
    return lines
  }
}

function splitRaw(buffer: Buffer): LogLine[] {
  return buffer
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => parseLine(line, 'stdout'))
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?(.*)$/s

// Traefik and most modern runtimes colour their output even without a TTY. A
// log viewer that prints the escape codes verbatim is worse than useless.
// biome-ignore lint/suspicious/noControlCharactersInRegex: The ANSI escape sequence intentionally starts with an escape character.
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g

function parseLine(line: string, stream: 'stdout' | 'stderr'): LogLine {
  const cleaned = line.replace(ANSI, '').replace(/\r$/, '')
  const match = TIMESTAMP.exec(cleaned)
  if (match) return { stream, timestamp: match[1] ?? null, text: match[2] ?? '' }
  return { stream, timestamp: null, text: cleaned }
}
