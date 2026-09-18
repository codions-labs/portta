// How a measurement looks once it is on screen.
//
// The browser must not import portta-core (its index pulls node:fs), so the
// thresholds are repeated here and must stay in step with PRESSURE_THRESHOLDS
// in packages/core/src/pressure.ts. The server decides the host's overall
// verdict; this only decides what colour one bar is.

import type { HostPressure } from 'portta-contracts'

export type ResourceKind = 'cpu' | 'memory' | 'swap' | 'storage' | 'gpu' | 'temperature' | 'load' | 'battery'

/** Mirrors PRESSURE_THRESHOLDS. */
export const RESOURCE_THRESHOLDS: Record<ResourceKind, { watch: number; high: number }> = {
  cpu: { watch: 0.8, high: 0.92 },
  memory: { watch: 0.85, high: 0.93 },
  swap: { watch: 0.25, high: 0.6 },
  storage: { watch: 0.85, high: 0.93 },
  gpu: { watch: 0.85, high: 0.95 },
  temperature: { watch: 85, high: 95 },
  load: { watch: 1.5, high: 3 },
  battery: { watch: 0.25, high: 0.1 },
}

export type ResourceTone = 'ok' | 'warn' | 'danger' | 'neutral'

/**
 * Every resource answers the same question — is this
 * comfortable, worth a look, or a problem — against the same thresholds the
 * host verdict uses.
 */
export function resourceTone(value: number | null, kind: ResourceKind = 'storage'): ResourceTone {
  if (value === null || !Number.isFinite(value)) return 'neutral'
  const thresholds = RESOURCE_THRESHOLDS[kind]
  // Battery is the one measurement where less is worse.
  if (kind === 'battery') {
    if (value <= thresholds.high) return 'danger'
    if (value <= thresholds.watch) return 'warn'
    return 'ok'
  }
  if (value >= thresholds.high) return 'danger'
  if (value >= thresholds.watch) return 'warn'
  return 'ok'
}

const BAR: Record<ResourceTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-subtle',
}

const TEXT: Record<ResourceTone, string> = {
  ok: 'text-ink',
  warn: 'text-warn',
  danger: 'text-danger',
  neutral: 'text-subtle',
}

export function resourceBarClass(tone: ResourceTone): string {
  return BAR[tone]
}

export function resourceTextClass(tone: ResourceTone): string {
  return TEXT[tone]
}

export function percentLabel(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null
  return `${Math.round(ratio * 100)}%`
}

/** The badge tone for the host's overall verdict. */
export function pressureTone(level: HostPressure['level']): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (level) {
    case 'watch':
      return 'warn'
    case 'pressured':
      return 'warn'
    case 'critical':
      return 'danger'
    default:
      return 'ok'
  }
}
