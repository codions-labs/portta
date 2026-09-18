import { describe, expect, it } from 'vitest'
import { createApi } from './client.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function recordingFetch(paths: string[], respond: (url: string) => Response): typeof fetch {
  return async (input) => {
    const url = String(input)
    paths.push(url)
    return respond(url)
  }
}

describe('createApi', () => {
  it('encodes slash-containing path params before interpolating them', async () => {
    const paths: string[] = []
    const api = createApi('https://example.com', { fetch: recordingFetch(paths, () => json({ ok: true })) })

    await api.sendWorktreePrompt({
      params: { name: 'feature/search' },
      body: { text: 'Fix the failing tests' },
    })

    expect(paths).toEqual(['https://example.com/api/worktrees/feature%2Fsearch/send'])
  })

  it('preserves numeric path params for notification and CI routes', async () => {
    const paths: string[] = []
    const api = createApi('https://example.com', {
      fetch: recordingFetch(paths, (url) => (url.endsWith('/dismiss') ? json({ ok: true }) : json({ logs: '' }))),
    })

    await api.dismissNotification({ params: { id: 42 } })
    await api.fetchCiLogs({ params: { runId: 317 } })

    expect(paths).toEqual(['https://example.com/api/notifications/42/dismiss', 'https://example.com/api/ci-logs/317'])
  })

  it('sends base headers, JSON bodies and query strings', async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = []
    const api = createApi('/alpha', {
      baseHeaders: { Authorization: 'Bearer secret' },
      fetch: async (input, init) => {
        seen.push({ url: String(input), init })
        return json({ branches: [] })
      },
    })

    await api.fetchAvailableBranches({ query: { includeRemote: true } })
    await api.pullMain({ body: { force: true } })

    expect(seen[0]?.url).toBe('/alpha/api/branches?includeRemote=true')
    expect(seen[0]?.init?.body).toBeUndefined()
    expect(seen[1]?.init).toMatchObject({
      method: 'POST',
      body: '{"force":true}',
      headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
    })
  })

  it('throws API error messages from json error bodies', async () => {
    const api = createApi('https://example.com', { fetch: async () => json({ error: 'Not found' }, 404) })

    await expect(api.dismissNotification({ params: { id: 7 } })).rejects.toThrow('Not found')
  })

  it('throws API error messages from stringified json error bodies', async () => {
    const api = createApi('https://example.com', {
      fetch: async () => new Response(JSON.stringify({ error: 'Gateway unavailable' }), { status: 502 }),
    })

    await expect(api.fetchCiLogs({ params: { runId: 99 } })).rejects.toThrow('Gateway unavailable')
  })
})
