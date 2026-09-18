import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvironmentReport, type MetricsCurrent, type MetricsHistory, SecurityReport } from 'portta-contracts'
import { emptySnapshot } from 'portta-core'
import { afterEach, describe, expect, it } from 'vitest'
import { GATEWAY } from './fixtures.ts'
import { makeApp } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function metricsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'portta-metrics-'))
  dirs.push(dir)
  return dir
}

describe('GET /api/environment', () => {
  it('answers never collected without turning a missing file into an error', async () => {
    const dir = metricsDir()
    const { app } = makeApp({ containers: GATEWAY }, { environmentDir: dir })
    const response = await app.request('/api/environment')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ collectedAt: null, ageSeconds: null, stale: true, checks: [] })
    expect(() => EnvironmentReport.parse(body)).not.toThrow()
  })

  it('coerces the host file, recomputes counts and reports its age', async () => {
    const dir = metricsDir()
    const now = Math.floor(Date.now() / 1000)
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({
        version: 1,
        collectedAt: now - 20,
        durationMs: 125,
        checks: [
          {
            id: 'docker',
            status: 'pass',
            title: 'Docker',
            detail: '27',
            fix: '',
            category: 'infrastructure',
            tool: { installed: true, version: '27', path: '/bin/docker' },
          },
          {
            id: 'gh',
            status: 'warn',
            title: 'GitHub CLI',
            detail: 'not authenticated',
            fix: 'gh auth login',
            category: 'development',
          },
          { bad: 'discard me' },
        ],
        summary: { passed: 999 },
      }),
    )
    const { app } = makeApp({ containers: GATEWAY }, { environmentDir: dir, environmentStaleSeconds: 30 })
    const body = EnvironmentReport.parse(await (await app.request('/api/environment')).json())
    expect(body.ageSeconds).toBeGreaterThanOrEqual(20)
    expect(body.stale).toBe(false)
    expect(body.checks).toHaveLength(2)
    expect(body.summary).toEqual({ passed: 1, recommendations: 1, problems: 0, information: 0, ok: true })
  })
})

describe('GET /api/environment/security', () => {
  it('returns validated findings with age and does not trust counts from disk', async () => {
    const dir = metricsDir()
    const now = Math.floor(Date.now() / 1000)
    writeFileSync(
      join(dir, 'security.json'),
      JSON.stringify({
        version: 1,
        collectedAt: now - 10,
        durationMs: 40,
        checks: [
          {
            id: 'security.sshd',
            status: 'info',
            title: 'SSH server',
            detail: 'could not be checked',
            fix: '',
            category: 'security',
            rationale: 'Effective configuration needs permission.',
            docs: 'docs/product/guides/remote-bootstrap.md',
          },
        ],
        summary: { problems: 42 },
      }),
    )
    const { app } = makeApp({ containers: GATEWAY }, { environmentDir: dir, environmentStaleSeconds: 30 })
    const body = SecurityReport.parse(await (await app.request('/api/environment/security')).json())
    expect(body).toMatchObject({ stale: false, summary: { information: 1, problems: 0, ok: true } })
    expect(body.checks[0]?.detail).toBe('could not be checked')
  })
})

describe('GET /api/metrics/current', () => {
  it('answers empty when the collector has not written yet', async () => {
    const dir = metricsDir()
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir, metricsStaleSeconds: 30 })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.host).toBeNull()
    expect(body.collectorActive).toBe(false)
    expect(body.stale).toBe(true)
    expect(body.projects).toEqual([])
  })

  it('returns the snapshot and flags it stale after 30s', async () => {
    const dir = metricsDir()
    const snapshot = emptySnapshot({ id: 'inst', name: 'lab', hostname: 'lab' }, 1_000)
    snapshot.host.cpuUtilisation = 0.34
    snapshot.host.memoryTotalBytes = 36
    snapshot.host.memoryUsedBytes = 18
    snapshot.projects = [
      {
        id: 'alpha',
        name: 'Alpha',
        composeProject: 'alpha',
        cpuUtilisation: 0.2,
        memoryUsedBytes: 4,
        containerCount: 1,
        networkRxBytes: 0,
        networkTxBytes: 0,
        containers: [],
      },
    ]
    writeFileSync(join(dir, 'current.json'), JSON.stringify(snapshot))
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir, metricsStaleSeconds: 30 })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.host?.cpuUtilisation).toBe(0.34)
    expect(body.projects[0]?.name).toBe('Alpha')
    expect(body.stale).toBe(true)
    expect(body.collectorActive).toBe(false)
  })

  it('treats a malformed file as not collected', async () => {
    const dir = metricsDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'current.json'), '{broken\n')
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir })
    const body = (await (await app.request('/api/metrics/current')).json()) as MetricsCurrent
    expect(body.collectedAt).toBeNull()
    expect(body.host).toBeNull()
  })
})

describe('GET /api/metrics/history', () => {
  it('returns points inside the requested window', async () => {
    const dir = metricsDir()
    const now = Math.floor(Date.now() / 1000)
    writeFileSync(
      join(dir, 'history.jsonl'),
      [
        JSON.stringify({ timestamp: now - 4000, host: { cpuUtilisation: 0.9 }, projects: [], containers: [] }),
        JSON.stringify({
          timestamp: now - 60,
          host: {
            cpuUtilisation: 0.2,
            memoryUsedBytes: 1,
            memoryUsedPercent: 0.1,
            storageUsedPercent: null,
            load: null,
            gpuUtilisation: null,
            temperatureCelsius: null,
          },
          projects: [],
          containers: [],
        }),
        '',
      ].join('\n'),
    )
    const { app } = makeApp({ containers: GATEWAY }, { metricsDir: dir })
    const body = (await (await app.request('/api/metrics/history?window=30m')).json()) as MetricsHistory
    expect(body.windowSeconds).toBe(1800)
    expect(body.points).toHaveLength(1)
    expect(body.points[0]?.host.cpuUtilisation).toBe(0.2)
  })
})
