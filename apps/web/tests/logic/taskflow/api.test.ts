// Where the dashboard sends each call: the panel serves Taskflow at the same
// paths the host daemon does, the registry at the module root and everything
// else under the Taskflow Project's prefix. A call that lands anywhere else is
// a 404 from the proxy, which is why the addresses are worth a test.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectApi, setUpProject } from '@/modules/taskflow/lib/api/index'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a Taskflow Project API', () => {
  it('sends contract calls, streams and uploads under /api/modules/taskflow/<prefix>', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        return jsonResponse({ worktrees: [], runs: [], files: [] })
      }),
    )
    const streams: string[] = []
    vi.stubGlobal(
      'EventSource',
      class {
        constructor(url: string) {
          streams.push(url)
        }
        addEventListener() {}
        close() {}
      },
    )
    const api = createProjectApi('my shop')

    await api.fetchWorktrees()
    await api.fetchRuns()
    await api.uploadFiles('feature/login', [new File(['x'], 'a.png')])
    api.subscribeNotifications({ onNotification: () => {}, onDismiss: () => {} })()
    api.connectRunEventStream('run_1', 3, { onEvent: () => {}, onError: () => {} })()

    expect(calls).toEqual([
      'GET /api/modules/taskflow/my%20shop/api/worktrees',
      'GET /api/modules/taskflow/my%20shop/api/projects/my%20shop/runs',
      'POST /api/modules/taskflow/my%20shop/api/worktrees/feature%2Flogin/upload',
    ])
    expect(streams).toEqual([
      '/api/modules/taskflow/my%20shop/api/notifications/stream',
      '/api/modules/taskflow/my%20shop/api/runs/run_1/stream?after=3',
    ])
  })

  it('opens sockets under /ws/modules/taskflow/<prefix> on this origin', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'panel.example.com' } })
    expect(createProjectApi('shop').socketUrl('/ws/feature%2Flogin')).toBe(
      'wss://panel.example.com/ws/modules/taskflow/shop/ws/feature%2Flogin',
    )
  })
})

describe('adding a directory to Taskflow', () => {
  it('registers at the module root and resolves at once when the repository is already set up', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        initializing: false,
        path: '/repo/y',
        project: { prefix: 'y', name: 'Y', path: '/repo/y', active: false },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const phases: string[] = []

    await expect(setUpProject('/repo/y', (phase) => phases.push(phase))).resolves.toEqual({ prefix: 'y' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/modules/taskflow/api/projects',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(phases).toEqual([])
  })

  it('follows the setup job until it is ready, and rejects with the reason when it fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST')
          return jsonResponse({ initializing: true, path: String(JSON.parse(String(init.body)).path), project: null })
        return jsonResponse({
          inits: [
            { path: '/repo/x', phase: 'ready', prefix: 'x', name: 'X', error: null },
            { path: '/repo/z', phase: 'failed', prefix: null, name: null, error: 'not a git repo' },
          ],
        })
      }),
    )
    const phases: string[] = []

    await expect(setUpProject('/repo/x', (phase) => phases.push(phase))).resolves.toEqual({ prefix: 'x' })
    expect(phases).toEqual(['ready'])
    await expect(setUpProject('/repo/z')).rejects.toThrow('not a git repo')
  })
})
