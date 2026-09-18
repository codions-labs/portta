import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogStream } from '@/lib/ws'

/** A WebSocket a test can open, feed and close. */
class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1
  readonly OPEN = 1
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  deliver(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }

  close() {
    this.closed = true
    this.readyState = 3
  }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const lines = (texts: string[]) => ({
  kind: 'lines',
  service: 'web',
  lines: texts.map((text) => ({ stream: 'stdout', timestamp: null, text })),
})

describe('following a log over a socket', () => {
  it('opens nothing until it is asked to', () => {
    renderHook(() => useLogStream('alpha', 'web', { enabled: false }))
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('addresses the environment, the service and the tail', () => {
    renderHook(() => useLogStream('alpha', 'web', { enabled: true, tail: 500 }))
    const url = new URL(FakeSocket.instances[0]!.url)
    expect(url.pathname).toBe('/ws/environments/alpha/logs')
    expect(url.searchParams.get('service')).toBe('web')
    expect(url.searchParams.get('tail')).toBe('500')
  })

  it('collects what arrives, in batches rather than per frame', async () => {
    const { result } = renderHook(() => useLogStream('alpha', 'web', { enabled: true }))
    const socket = FakeSocket.instances[0]!
    act(() => socket.open())
    act(() => {
      socket.deliver(lines(['first', 'second']))
      socket.deliver(lines(['third']))
    })
    // Nothing yet: the frames are buffered until the next flush.
    expect(result.current.lines).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(result.current.lines.map((line) => line.text)).toEqual(['first', 'second', 'third'])
    expect(result.current.state).toBe('open')
  })

  it('ignores a frame it does not recognise', async () => {
    const { result } = renderHook(() => useLogStream('alpha', null, { enabled: true }))
    const socket = FakeSocket.instances[0]!
    act(() => socket.open())
    act(() => {
      socket.deliver({ kind: 'open', environment: 'alpha' })
      socket.onmessage?.({ data: 'not json at all' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(result.current.lines).toHaveLength(0)
  })

  it('reconnects after a connection that dropped, and backs off', async () => {
    const { result } = renderHook(() => useLogStream('alpha', 'web', { enabled: true }))
    act(() => FakeSocket.instances[0]!.open())
    act(() => FakeSocket.instances[0]!.drop())
    expect(result.current.state).toBe('retrying')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })
    expect(FakeSocket.instances.length).toBeGreaterThan(1)
  })

  it('gives up saying so, rather than retrying forever', async () => {
    const { result } = renderHook(() => useLogStream('alpha', 'web', { enabled: true }))
    // Never opening: a server that is not there, rather than a connection that
    // was lost. Six failures, five waits, and then it stops — a viewer that
    // reconnects forever is a viewer that never says the stream is not coming
    // back.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      act(() => FakeSocket.instances.at(-1)!.drop())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
      })
    }
    expect(result.current.state).toBe('failed')
    expect(FakeSocket.instances).toHaveLength(6)
  })

  // A connection that worked and then dropped is not the same as one that was
  // never accepted: the wait starts over, because the far side came back once.
  it('starts the backoff over after a connection that had opened', async () => {
    const { result } = renderHook(() => useLogStream('alpha', 'web', { enabled: true }))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const socket = FakeSocket.instances.at(-1)!
      act(() => socket.open())
      act(() => socket.drop())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000)
      })
    }
    expect(result.current.state).not.toBe('failed')
  })

  // 1008 is the server saying the parameters were wrong, and 1000 is a stream
  // that ended because the container stopped. Retrying either is noise.
  it('does not retry a refusal or a clean end', async () => {
    const { result } = renderHook(() => useLogStream('alpha', 'web', { enabled: true }))
    act(() => FakeSocket.instances[0]!.open())
    act(() => FakeSocket.instances[0]!.drop(1008))
    expect(result.current.state).toBe('failed')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('closes the socket when following is turned off', () => {
    const { rerender } = renderHook(({ enabled }) => useLogStream('alpha', 'web', { enabled }), {
      initialProps: { enabled: true },
    })
    const socket = FakeSocket.instances[0]!
    rerender({ enabled: false })
    expect(socket.closed).toBe(true)
  })
})
