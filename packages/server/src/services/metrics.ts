// The panel only reads what the CLI collector wrote. It never calls
// systeminformation or docker stats.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { MetricsCurrent, MetricsHistory } from 'portta-contracts'
import { type MetricsHistoryPoint, type MetricsSnapshot, parseHistoryLines } from 'portta-core'
import type { PanelConfig } from '../config.ts'

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

export function readCurrentMetrics(config: PanelConfig, now = Date.now()): MetricsCurrent {
  const parsed = readJsonFile(join(config.metricsDir, 'current.json')) as MetricsSnapshot | null
  if (parsed?.version !== 1 || !parsed.host) return emptyMetrics()
  const collectedAt = typeof parsed.collectedAt === 'number' && parsed.collectedAt > 0 ? parsed.collectedAt : null
  const ageSeconds = collectedAt !== null ? Math.max(0, Math.floor(now / 1000) - collectedAt) : null
  return {
    version: 1,
    instance: parsed.instance ?? { id: '', name: null, hostname: null },
    collectedAt,
    ageSeconds,
    stale: ageSeconds === null || ageSeconds > config.metricsStaleSeconds,
    collectorActive: ageSeconds !== null && ageSeconds <= config.metricsStaleSeconds,
    host: parsed.host,
    runtime: parsed.runtime ?? null,
    projects: parsed.projects ?? [],
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
  if (!existsSync(path)) return { windowSeconds, points: [] }
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return { windowSeconds, points: [] }
    const since = Math.floor(now / 1000) - windowSeconds
    const points = parseHistoryLines(readFileSync(path, 'utf8'), since) as MetricsHistoryPoint[]
    return { windowSeconds, points }
  } catch {
    return { windowSeconds, points: [] }
  }
}
