// Is this host in a state to take more work?
//
// The panel already showed CPU, memory and disk. Three numbers are not an
// answer: an operator glancing at the dashboard wants to know whether to start
// another environment, and that is one word, not three percentages.
//
// Every threshold here is a judgement about a *development* host — a machine
// running a person's own stacks, where a sustained 90% is uncomfortable rather
// than an outage. Nothing is invented: each reason names the measurement that
// produced it, and a resource this host does not report contributes nothing.

import type { HostMetrics } from './metrics.ts'

export type PressureLevel = 'normal' | 'watch' | 'pressured' | 'critical'

export type PressureResource = 'cpu' | 'memory' | 'swap' | 'storage' | 'gpu' | 'temperature' | 'load' | 'battery'

export interface PressureReason {
  resource: PressureResource
  level: Exclude<PressureLevel, 'normal'>
  /** The measurement behind it: a ratio for anything measured 0-1, else the raw reading. */
  value: number
}

export interface HostPressure {
  level: PressureLevel
  /** What made it that, worst first. Empty when the level is normal. */
  reasons: PressureReason[]
  /** False when the collector is off or the snapshot is old: the level is then 'normal' and means nothing. */
  measured: boolean
}

/**
 * Where each resource stops being comfortable. Two steps per resource: the
 * first is worth noticing, the second is worth acting on.
 */
export const PRESSURE_THRESHOLDS = {
  cpu: { watch: 0.8, high: 0.92 },
  memory: { watch: 0.85, high: 0.93 },
  swap: { watch: 0.25, high: 0.6 },
  storage: { watch: 0.85, high: 0.93 },
  gpu: { watch: 0.85, high: 0.95 },
  /** Celsius. Sustained thermal throttling starts around here on most laptops. */
  temperature: { watch: 85, high: 95 },
  /** Load average per logical core. */
  load: { watch: 1.5, high: 3 },
  /** Remaining charge, on battery and not charging. */
  battery: { watch: 0.25, high: 0.1 },
} as const

const RANK: Record<PressureLevel, number> = { normal: 0, watch: 1, pressured: 2, critical: 3 }

function worse(left: PressureLevel, right: PressureLevel): PressureLevel {
  return RANK[left] >= RANK[right] ? left : right
}

function gauge(
  resource: PressureResource,
  value: number | null,
  thresholds: { watch: number; high: number },
): PressureReason | null {
  if (value === null || !Number.isFinite(value)) return null
  if (value >= thresholds.high) return { resource, level: 'pressured', value }
  if (value >= thresholds.watch) return { resource, level: 'watch', value }
  return null
}

/**
 * The host's state in one word, with the readings that produced it.
 *
 * `critical` is deliberately hard to reach: it needs two resources already
 * past their high mark, or memory and swap together — the shape of a machine
 * that is about to start killing processes rather than one that is merely busy.
 */
export function hostPressure(
  host: HostMetrics | null,
  options: { stale?: boolean; collectorActive?: boolean } = {},
): HostPressure {
  const measured = host !== null && options.stale !== true && options.collectorActive !== false
  if (!host || !measured) return { level: 'normal', reasons: [], measured: false }

  const swapRatio =
    host.swapTotalBytes && host.swapTotalBytes > 0 && host.swapUsedBytes !== null
      ? host.swapUsedBytes / host.swapTotalBytes
      : null
  const cores = host.cpu.logicalCores
  const loadPerCore = host.load && cores && cores > 0 ? host.load.five / cores : null
  const gpuUsage = host.gpu.map((gpu) => gpu.utilisation).find((value) => value !== null) ?? null

  const reasons: PressureReason[] = []
  for (const reason of [
    gauge('memory', host.memoryUsedPercent, PRESSURE_THRESHOLDS.memory),
    gauge('cpu', host.cpuUtilisation, PRESSURE_THRESHOLDS.cpu),
    gauge('storage', host.storage?.usedPercent ?? null, PRESSURE_THRESHOLDS.storage),
    gauge('swap', swapRatio, PRESSURE_THRESHOLDS.swap),
    gauge('gpu', gpuUsage, PRESSURE_THRESHOLDS.gpu),
    gauge('temperature', host.temperatureCelsius, PRESSURE_THRESHOLDS.temperature),
    gauge('load', loadPerCore, PRESSURE_THRESHOLDS.load),
  ]) {
    if (reason) reasons.push(reason)
  }

  // A laptop draining its battery is under a pressure no percentage of CPU
  // describes: the work will stop when the charge does.
  const battery = host.battery
  if (battery?.hasBattery && !battery.acConnected && battery.percent !== null) {
    if (battery.percent <= PRESSURE_THRESHOLDS.battery.high)
      reasons.push({ resource: 'battery', level: 'pressured', value: battery.percent })
    else if (battery.percent <= PRESSURE_THRESHOLDS.battery.watch)
      reasons.push({ resource: 'battery', level: 'watch', value: battery.percent })
  }

  let level: PressureLevel = 'normal'
  for (const reason of reasons) level = worse(level, reason.level)

  const high = reasons.filter((reason) => reason.level === 'pressured')
  const memoryAndSwap =
    high.some((reason) => reason.resource === 'memory') && high.some((reason) => reason.resource === 'swap')
  if (high.length >= 2 || memoryAndSwap) level = 'critical'

  reasons.sort((left, right) => RANK[right.level] - RANK[left.level])
  return { level, reasons, measured: true }
}
