// What the one process decides, without starting one.
//
// `createPortta` takes the handlers rather than building them, so the whole
// dispatch is exercised here with a fake Next, no Docker, no database and no
// port. What is asserted is the boundary: which requests reach the API, which
// reach the pages, and which upgrades are refused before they become sockets.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { PassThrough } from 'node:stream'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createPortta, type Startable } from '../../server/compose.ts'

/** Stands in for `createApp`, which mounts the real routes under `/api`. */
function api(): Hono {
  const app = new Hono()
  app.get('/api/health', (c) => c.json({ ok: true, panelVersion: '0.1.0' }))
  app.get('/api/events', () => new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
  return app
}

/** A response object that records what was written to it. */
function capture() {
  const chunks: string[] = []
  const headers = new Map<string, string>()
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), String(value)),
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    writeHead: (status: number, given?: Record<string, string>) => {
      response.statusCode = status
      for (const [name, value] of Object.entries(given ?? {})) headers.set(name.toLowerCase(), value)
      return response
    },
    write: (chunk: unknown) => {
      chunks.push(String(chunk))
      return true
    },
    end: (chunk?: unknown) => {
      if (chunk !== undefined) chunks.push(String(chunk))
      response.finished = true
      return response
    },
    finished: false,
    on: () => response,
    once: () => response,
    emit: () => false,
    removeListener: () => response,
  }
  return { response: response as unknown as ServerResponse, chunks, headers }
}

function request(url: string): IncomingMessage {
  return { url, method: 'GET', headers: { host: '127.0.0.1' } } as unknown as IncomingMessage
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('the dispatcher', () => {
  it('sends /api to the API', async () => {
    const portta = createPortta({ api: api(), next: () => undefined })
    const { response, chunks } = capture()
    portta.handle(request('/api/health'), response)
    await settle()
    expect(chunks.join('')).toContain('"ok":true')
  })

  it('sends everything else to Next', () => {
    const next = vi.fn()
    const portta = createPortta({ api: api(), next })
    const { response } = capture()
    portta.handle(request('/overview'), response)
    expect(next).toHaveBeenCalledOnce()
  })

  // `/apiary` is a page, not the API. A `startsWith('/api')` would have taken it.
  it('does not mistake a path that merely begins with the letters', () => {
    const next = vi.fn()
    const portta = createPortta({ api: api(), next })
    const { response } = capture()
    portta.handle(request('/apiary'), response)
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('an upgrade', () => {
  function socket() {
    const stream = new PassThrough()
    const written: string[] = []
    const destroyed = vi.fn()
    stream.on('data', (chunk: Buffer) => written.push(chunk.toString()))
    Object.defineProperty(stream, 'destroy', { value: destroyed })
    return { stream, written, destroyed }
  }

  // A `/ws/…` path with no handler behind it is refused rather than handed to
  // Next: falling through would leave the client waiting for a handshake
  // nothing is going to answer.
  it('refuses /ws with no handler, and closes the socket', async () => {
    const portta = createPortta({ api: api(), next: () => undefined })
    const { stream, written, destroyed } = socket()
    await portta.upgrade(request('/ws/environments/alpha/logs'), stream, Buffer.alloc(0))
    expect(written.join('')).toContain('404')
    expect(destroyed).toHaveBeenCalledOnce()
  })

  it('gives every /ws path to the panel handler, including the ones it refuses', async () => {
    const wsUpgrade = vi.fn().mockResolvedValue(true)
    const nextUpgrade = vi.fn()
    const portta = createPortta({ api: api(), next: () => undefined, wsUpgrade, nextUpgrade })
    const { stream, destroyed } = socket()
    await portta.upgrade(request('/ws/environments/alpha/logs'), stream, Buffer.alloc(0))
    expect(wsUpgrade).toHaveBeenCalledOnce()
    // The handler answered, so nothing else touches the socket.
    expect(nextUpgrade).not.toHaveBeenCalled()
    expect(destroyed).not.toHaveBeenCalled()
  })

  it('and still refuses a /ws path the panel handler did not claim', async () => {
    const wsUpgrade = vi.fn().mockResolvedValue(false)
    const portta = createPortta({ api: api(), next: () => undefined, wsUpgrade })
    const { stream, written, destroyed } = socket()
    await portta.upgrade(request('/ws/nothing'), stream, Buffer.alloc(0))
    expect(written.join('')).toContain('404')
    expect(destroyed).toHaveBeenCalledOnce()
  })

  it('hands anything else to Next, which owns HMR in development', async () => {
    const nextUpgrade = vi.fn()
    const portta = createPortta({ api: api(), next: () => undefined, nextUpgrade })
    const { stream } = socket()
    await portta.upgrade(request('/_next/webpack-hmr'), stream, Buffer.alloc(0))
    expect(nextUpgrade).toHaveBeenCalledOnce()
  })

  it('refuses it in production, where nothing but /ws asks', async () => {
    const portta = createPortta({ api: api(), next: () => undefined })
    const { stream, destroyed } = socket()
    await portta.upgrade(request('/_next/webpack-hmr'), stream, Buffer.alloc(0))
    expect(destroyed).toHaveBeenCalledOnce()
  })
})

describe('the lifecycle', () => {
  it('starts and stops what it was given, and closes the rest', async () => {
    const job: Startable = { start: vi.fn(), stop: vi.fn() }
    const close = vi.fn().mockResolvedValue(undefined)
    const portta = createPortta({ api: api(), next: () => undefined, jobs: [job], close })

    portta.start()
    expect(job.start).toHaveBeenCalledOnce()

    await portta.stop()
    expect(job.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('documentation availability before Next static files', () => {
  it('refuses every docs surface while leaving application routes available', () => {
    const next = vi.fn()
    const portta = createPortta({ api: api(), next, documentation: { docs: false, apiDocs: false } })
    for (const path of [
      '/docs',
      '/docs/install',
      '/docs/images/auth-disabled-overview.png',
      '/docs?x=1',
      '/%64ocs/install',
      '/docs/api/',
    ]) {
      const { response } = capture()
      portta.handle(request(path), response)
      expect(response.statusCode).toBe(404)
    }
    expect(next).not.toHaveBeenCalled()
    portta.handle(request('/overview'), capture().response)
    expect(next).toHaveBeenCalledOnce()
  })
  it('can disable the interactive API reference while serving Markdown', () => {
    const next = vi.fn()
    const portta = createPortta({ api: api(), next, documentation: { docs: true, apiDocs: false } })
    const { response } = capture()
    portta.handle(request('/docs/api'), response)
    expect(response.statusCode).toBe(404)
    portta.handle(request('/docs/install'), capture().response)
    expect(next).toHaveBeenCalledOnce()
  })
})
