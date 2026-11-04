// The panel only reads what the CLI collector wrote. It never calls
// systeminformation or docker stats.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { MetricsCurrent, MetricsHistory } from 'portta-contracts'
import { type MetricsHistoryPoint, type MetricsSnapshot, parseHistoryLines } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { liveMetrics } from './live-metrics.ts'

const MAX_FILE_BYTES = 2 * 1024 * 1024

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function emptyMetrics(): MetricsCurrent {
  return {
    version: 1,
    instance: { id: '', name: null, hostname: null },
    collectedAt: null,
    ageSeconds: null,
    stale: true,
    collectorActive: false,
    host: null,
    runtime: null,
    projects: [],
  }
}

/**
 * The newest reading the panel has of the server.
 *
 * The host collector's file when it is being written, since it reads what only the host
 * can (git, project files, a GPU, a battery). When it is not (a reboot stopped it and
 * nothing started it again) the panel's own reading takes over where it can see the
 * machine, so the numbers are live instead of hours old. Where it cannot, the stale file is
 * still returned and says it is stale.
 */
export function readCurrentMetrics(config: PanelConfig, now = Date.now()): MetricsCurrent {
  const parsed = readJsonFile(join(config.metricsDir, 'current.json')) as MetricsSnapshot | null
  const file = parsed?.version === 1 && parsed.host ? parsed : null
  const collectedAt = file && typeof file.collectedAt === 'number' && file.collectedAt > 0 ? file.collectedAt : null
  const ageSeconds = collectedAt !== null ? Math.max(0, Math.floor(now / 1000) - collectedAt) : null
  const fresh = ageSeconds !== null && ageSeconds <= config.metricsStaleSeconds

  if (!fresh) {
    const live = liveMetrics()?.snapshot() ?? null
    if (live) return fromLive(live, file, now)
  }
  if (!file) return emptyMetrics()
  return {
    version: 1,
    instance: file.instance ?? { id: '', name: null, hostname: null },
    collectedAt,
    ageSeconds,
    stale: !fresh,
    collectorActive: fresh,
    host: file.host,
    runtime: file.runtime ?? null,
    projects: file.projects ?? [],
    dockerStorage: file.dockerStorage ?? null,
  }
}

/** What only the host knows stays from the last file; what changes comes from the panel. */
function fromLive(live: MetricsSnapshot, file: MetricsSnapshot | null, now: number): MetricsCurrent {
  const old = file?.host
  const host = old
    ? {
        ...live.host,
        manufacturer: old.manufacturer,
        model: old.model,
        productName: old.productName,
        kind: old.kind,
        virtual: old.virtual,
        timezone: old.timezone ?? null,
        utcOffsetMinutes: old.utcOffsetMinutes ?? null,
        cpu: { ...old.cpu, logicalCores: live.host.cpu.logicalCores ?? old.cpu.logicalCores },
        gpu: old.gpu,
      }
    : live.host
  // The collector adds where a project's code stands to what core describes.
  type Git = MetricsCurrent['projects'][number]['git']
  const git = new Map<string, Git>(
    (file?.projects ?? []).map((project) => [project.composeProject, (project as { git?: Git }).git]),
  )
  return {
    version: 1,
    instance: file?.instance ?? live.instance,
    collectedAt: live.collectedAt,
    ageSeconds: Math.max(0, Math.floor(now / 1000) - live.collectedAt),
    stale: false,
    collectorActive: true,
    host,
    runtime: live.runtime,
    projects: live.projects.map((project) => {
      const last = git.get(project.composeProject)
      return last ? { ...project, git: last } : project
    }),
    dockerStorage: live.dockerStorage ?? file?.dockerStorage ?? null,
  }
}

/**
 * What a principal who sees only some projects may read of the server's metrics.
 *
 * The host's own readings are the whole machine's and stay; what is per project (its
 * use, its disk, where its code stands) goes only for the projects they see, with
 * Portta's own containers. What they do not see stays inside the host's totals.
 */
export function metricsFor(metrics: MetricsCurrent, sees: (composeProject: string) => boolean): MetricsCurrent {
  const own = new Set(metrics.projects.filter((project) => project.own).map((project) => project.composeProject))
  const allowed = (composeProject: string) => own.has(composeProject) || sees(composeProject)
  return {
    ...metrics,
    projects: metrics.projects.filter((project) => allowed(project.composeProject)),
    dockerStorage: metrics.dockerStorage
      ? {
          ...metrics.dockerStorage,
          projects: metrics.dockerStorage.projects.filter((entry) => allowed(entry.composeProject)),
        }
      : metrics.dockerStorage,
  }
}

const WINDOWS: Record<string, number> = {
  '15m': 15 * 60,
  '30m': 30 * 60,
  '60m': 60 * 60,
  '1h': 60 * 60,
}

export function historyWindowSeconds(value: string | undefined): number {
  return WINDOWS[value ?? ''] ?? WINDOWS['30m'] ?? 1800
}

export function readMetricsHistory(config: PanelConfig, windowSeconds: number, now = Date.now()): MetricsHistory {
  const path = join(config.metricsDir, 'history.jsonl')
  if (!existsSync(path)) return { windowSeconds, points: withLive([], Math.floor(now / 1000) - windowSeconds) }
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return { windowSeconds, points: [] }
    const since = Math.floor(now / 1000) - windowSeconds
    const points = parseHistoryLines(readFileSync(path, 'utf8'), since) as MetricsHistoryPoint[]
    return { windowSeconds, points: withLive(points, since) }
  } catch {
    return { windowSeconds, points: [] }
  }
}

/** The collector's points, then the panel's own for the time the collector was not writing. */
function withLive(points: MetricsHistoryPoint[], since: number): MetricsHistoryPoint[] {
  const last = points.at(-1)?.timestamp ?? 0
  const own = liveMetrics()?.history(Math.max(since, last + 1)) ?? []
  return own.length === 0 ? points : [...points, ...own]
}
