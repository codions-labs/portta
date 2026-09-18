import type { ProjectLogsResponse } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { mergeLogSources } from '../src/services/projectlogs.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp } from './helpers.ts'

const line = (timestamp: string | null, text: string, stream: 'stdout' | 'stderr' = 'stdout') => ({
  stream,
  timestamp,
  text,
})

describe('mergeLogSources', () => {
  it('interleaves sources by timestamp', () => {
    const merged = mergeLogSources(
      [
        { service: 'web', lines: [line('2026-01-01T00:00:01Z', 'web one'), line('2026-01-01T00:00:03Z', 'web two')] },
        { service: 'api', lines: [line('2026-01-01T00:00:02Z', 'api one')] },
      ],
      100,
    )
    expect(merged.lines.map((entry) => entry.text)).toEqual(['web one', 'api one', 'web two'])
    expect(merged.lines.map((entry) => entry.service)).toEqual(['web', 'api', 'web'])
    expect(merged.ordered).toBe(true)
  })

  it('keeps an untimestamped line with its neighbours instead of at the front', () => {
    const merged = mergeLogSources(
      [
        {
          service: 'web',
          lines: [line('2026-01-01T00:00:05Z', 'first'), line(null, 'continued')],
        },
        { service: 'api', lines: [line('2026-01-01T00:00:01Z', 'early')] },
      ],
      100,
    )
    expect(merged.lines.map((entry) => entry.text)).toEqual(['early', 'first', 'continued'])
    expect(merged.ordered).toBe(false)
  })

  it('keeps the most recent lines when the overall budget is exceeded', () => {
    const merged = mergeLogSources(
      [
        {
          service: 'web',
          lines: [1, 2, 3, 4, 5].map((n) => line(`2026-01-01T00:00:0${n}Z`, `line ${n}`)),
        },
      ],
      2,
    )
    expect(merged.truncated).toBe(true)
    expect(merged.lines.map((entry) => entry.text)).toEqual(['line 4', 'line 5'])
  })
})

describe('GET /api/environments/:project/logs', () => {
  it('narrows to one service when asked', async () => {
    const { app } = makeApp({
      containers: [...GATEWAY, ...PROJECT_A],
      logsByContainer: {
        'a-web': [line('2026-01-01T00:00:01Z', 'web started')],
        'a-api': [line('2026-01-01T00:00:02Z', 'api started')],
      },
    })

    const body = (await (await app.request('/api/environments/alpha/logs?service=api')).json()) as ProjectLogsResponse
    expect(body.sources).toHaveLength(1)
    expect(body.lines.map((entry) => entry.text)).toEqual(['api started'])
  })

  it('reports a failing source beside the sources that answered', async () => {
    const { app } = makeApp({
      containers: [...GATEWAY, ...PROJECT_A],
      logsByContainer: {
        'a-web': [line('2026-01-01T00:00:01Z', 'web started')],
        'a-api': new Error('container is gone'),
      },
    })

    const response = await app.request('/api/environments/alpha/logs')
    expect(response.status).toBe(200)
    const body = (await response.json()) as ProjectLogsResponse

    expect(body.lines.map((entry) => entry.text)).toContain('web started')
    const api = body.sources.find((source) => source.service === 'api')!
    expect(api.error).toContain('container is gone')
    expect(api.lineCount).toBe(0)
    expect(body.sources.find((source) => source.service === 'web')!.error).toBeNull()
  })

  it('reports a stopped container without blanking the view', async () => {
    const stopped = PROJECT_A.map((item) => (item.id === 'a-api' ? { ...item, state: 'exited' } : item))
    const { app } = makeApp({
      containers: [...GATEWAY, ...stopped],
      logsByContainer: { 'a-api': [line('2026-01-01T00:00:02Z', 'shutting down')] },
    })

    const body = (await (await app.request('/api/environments/alpha/logs')).json()) as ProjectLogsResponse
    const api = body.sources.find((source) => source.service === 'api')!
    expect(api.state).toBe('exited')
    expect(body.lines.some((entry) => entry.text === 'shutting down')).toBe(true)
  })

  it('404s an unknown project rather than answering empty', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await app.request('/api/environments/ghost/logs')
    expect(response.status).toBe(404)
    expect((await response.json()).error).toContain("no environment 'ghost'")
  })

  it('clamps the requested tail per service', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    await app.request('/api/environments/alpha/logs?tail=99999')

    const reads = docker.calls.filter((call) => call.method === 'logs')
    expect(reads).toHaveLength(4)
    expect(reads.every((call) => (call.args[1] as { tail: number }).tail === 2000)).toBe(true)
  })

  it('reads every service concurrently with a smaller default when aggregating', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    await app.request('/api/environments/alpha/logs')

    const reads = docker.calls.filter((call) => call.method === 'logs')
    // Services come from the snapshot, which orders them alphabetically.
    expect(reads.map((call) => call.args[0])).toEqual(['a-api', 'a-postgres', 'a-redis', 'a-web'])
    expect(reads.every((call) => (call.args[1] as { tail: number }).tail === 100)).toBe(true)
  })
})
