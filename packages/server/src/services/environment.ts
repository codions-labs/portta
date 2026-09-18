// Host readiness is collected by the CLI. This service only reads and
// validates its bounded JSON file; it never probes the panel container.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Diagnostic, type EnvironmentReport } from 'portta-contracts'
import type { PanelConfig } from '../config.ts'

const MAX_FILE_BYTES = 2 * 1024 * 1024

export function emptyEnvironmentReport(): EnvironmentReport {
  return {
    version: 1,
    collectedAt: null,
    durationMs: null,
    ageSeconds: null,
    stale: true,
    checks: [],
    summary: { passed: 0, recommendations: 0, problems: 0, information: 0, ok: true },
  }
}

export function readHostReportFile(path: string, staleSeconds: number, now = Date.now()): EnvironmentReport {
  if (!existsSync(path)) return emptyEnvironmentReport()
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return emptyEnvironmentReport()
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (raw.version !== 1 || !Array.isArray(raw.checks)) return emptyEnvironmentReport()
    const checks = raw.checks.flatMap((entry) => {
      const parsed = Diagnostic.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
    const collectedAt =
      typeof raw.collectedAt === 'number' && Number.isInteger(raw.collectedAt) && raw.collectedAt > 0
        ? raw.collectedAt
        : null
    const durationMs =
      typeof raw.durationMs === 'number' && Number.isInteger(raw.durationMs) && raw.durationMs >= 0
        ? raw.durationMs
        : null
    const ageSeconds = collectedAt === null ? null : Math.max(0, Math.floor(now / 1000) - collectedAt)
    const count = (status: EnvironmentReport['checks'][number]['status']) =>
      checks.filter((entry) => entry.status === status).length
    const problems = count('fail')
    return {
      version: 1,
      collectedAt,
      durationMs,
      ageSeconds,
      stale: ageSeconds === null || ageSeconds > staleSeconds,
      checks,
      summary: {
        passed: count('pass'),
        recommendations: count('warn'),
        problems,
        information: count('info'),
        ok: problems === 0,
      },
    }
  } catch {
    return emptyEnvironmentReport()
  }
}

export function readEnvironmentReport(config: PanelConfig, now = Date.now()): EnvironmentReport {
  return readHostReportFile(join(config.environmentDir, 'report.json'), config.environmentStaleSeconds, now)
}
