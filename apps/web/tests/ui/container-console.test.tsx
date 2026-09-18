import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const fakes = vi.hoisted(() => ({ terminals: [] as any[], fits: [] as any[] }))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    writes: Uint8Array[] = []
    input: ((data: string) => void) | null = null
    constructor() {
      fakes.terminals.push(this)
    }
    loadAddon() {}
    open() {}
    focus() {}
    write(data: Uint8Array) {
      this.writes.push(data)
    }
    writeln() {}
    onData(callback: (data: string) => void) {
      this.input = callback
      return { dispose() {} }
    }
    dispose() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    constructor() {
      fakes.fits.push(this)
    }
    fit() {}
  },
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))

class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1
  readyState = 0
  binaryType = ''
  sent: Array<string | Uint8Array> = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  send(data: string | Uint8Array) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  deliver(data: string | ArrayBuffer) {
    this.onmessage?.({ data })
  }
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  fakes.terminals.length = 0
  fakes.fits.length = 0
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => vi.unstubAllGlobals())

const { ContainerConsole } = await import('@/components/container-console')

describe('the browser container console', () => {
  it('loads on demand and bridges terminal bytes and resize control frames', async () => {
    const rendered = renderWithQuery(<ContainerConsole environment="alpha one" service="api" enabled />, 'en')
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
    const socket = FakeSocket.instances[0]!
    const url = new URL(socket.url)
    expect(url.pathname).toBe('/ws/environments/alpha%20one/console')
    expect(url.searchParams.get('service')).toBe('api')
    expect(socket.binaryType).toBe('arraybuffer')

    act(() => socket.open())
    expect(JSON.parse(socket.sent[0] as string)).toEqual({ type: 'resize', cols: 80, rows: 24 })
    act(() => socket.deliver(JSON.stringify({ kind: 'open' })))
    expect(await screen.findByText('Connected')).toBeInTheDocument()

    const output = new Uint8Array([36, 32]).buffer
    act(() => socket.deliver(output))
    expect(Array.from(fakes.terminals[0].writes[0] as Uint8Array)).toEqual([36, 32])
    act(() => fakes.terminals[0].input('echo ok\n'))
    expect(Array.from(socket.sent.at(-1) as Uint8Array)).toEqual(Array.from(new TextEncoder().encode('echo ok\n')))

    rendered.unmount()
    expect(socket.closed).toBe(true)
  })

  it('does not load xterm or open a socket while its section is closed', async () => {
    renderWithQuery(<ContainerConsole environment="alpha" service="api" enabled={false} />, 'en')
    await act(async () => {})
    expect(fakes.terminals).toHaveLength(0)
    expect(FakeSocket.instances).toHaveLength(0)
  })
})
