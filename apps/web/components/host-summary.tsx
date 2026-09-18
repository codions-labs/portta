'use client'

import {
  BatteryCharging,
  BatteryMedium,
  Box,
  ChevronDown,
  Cpu,
  Gauge,
  HardDrive,
  Laptop,
  MemoryStick,
  Monitor,
  MonitorCog,
  Server,
  Thermometer,
} from 'lucide-react'
import type { HostKind, HostMetrics, HostPressure, MetricsCurrent, MetricsHistory } from 'portta-contracts'
import type { ComponentType } from 'react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  percentLabel,
  pressureTone,
  type ResourceKind,
  type ResourceTone,
  resourceBarClass,
  resourceTextClass,
  resourceTone,
} from '../lib/resources.ts'
import { narrowTone } from '../lib/tone.ts'
import { useFormat } from '../lib/use-format.ts'
import { cn } from '../lib/utils.ts'
import { Skeleton } from './shell-bits.tsx'
import { Sparkline } from './sparkline.tsx'
import { StatusIndicator } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Tooltip } from './ui/tooltip.tsx'

/** How long the history window the sparklines draw is, in minutes. */
export const HISTORY_MINUTES = 30

interface Reading {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** The number as an operator reads it. */
  value: string
  /** 0-1 for the bar; null leaves the bar out. */
  ratio: number | null
  tone: ResourceTone
  /** The line under it, when there is history for this measurement. */
  spark?: ReadonlyArray<number | null>
  /** Fixes the sparkline's scale, for a ratio that must not rescale to its own max. */
  sparkMax?: number
  /** What the number means, for the tooltip. */
  detail?: string
}

function toneOf(value: number | null, kind: ResourceKind): ResourceTone {
  return resourceTone(value, kind)
}

/**
 * Every measurement this host actually reports, in the order an operator scans
 * them. A host that has no GPU, no battery and no thermal sensor contributes
 * nothing for them — an empty tile saying "not measured" is worse than the
 * space it would take.
 */
export function readingsFor(
  host: HostMetrics,
  history: MetricsHistory | undefined,
  format: {
    bytes: (value: number | null | undefined) => string
    uptime: (seconds: number | null | undefined) => string
  },
  t: (key: string, options?: Record<string, unknown>) => string,
): Reading[] {
  const points = history?.points ?? []
  const readings: Reading[] = []

  readings.push({
    id: 'cpu',
    label: t('cpu'),
    icon: Cpu,
    value: percentLabel(host.cpuUtilisation) ?? '—',
    ratio: host.cpuUtilisation,
    tone: toneOf(host.cpuUtilisation, 'cpu'),
    spark: points.map((point) => point.host.cpuUtilisation),
    sparkMax: 1,
    detail:
      [host.cpu.brand, host.cpu.logicalCores !== null ? t('cores', { count: host.cpu.logicalCores }) : null]
        .filter(Boolean)
        .join(' · ') || undefined,
  })

  readings.push({
    id: 'memory',
    label: t('memory'),
    icon: MemoryStick,
    value:
      host.memoryTotalBytes !== null
        ? `${format.bytes(host.memoryUsedBytes)} / ${format.bytes(host.memoryTotalBytes)}`
        : '—',
    ratio: host.memoryUsedPercent,
    tone: toneOf(host.memoryUsedPercent, 'memory'),
    spark: points.map((point) => point.host.memoryUsedPercent),
    sparkMax: 1,
    detail:
      [
        percentLabel(host.memoryUsedPercent),
        host.swapTotalBytes
          ? `${t('swap')} ${format.bytes(host.swapUsedBytes)} / ${format.bytes(host.swapTotalBytes)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
  })

  if (host.storage) {
    readings.push({
      id: 'storage',
      label: t('storage.label'),
      icon: HardDrive,
      value: `${format.bytes(host.storage.usedBytes)} / ${format.bytes(host.storage.totalBytes)}`,
      ratio: host.storage.usedPercent,
      tone: toneOf(host.storage.usedPercent, 'storage'),
      spark: points.map((point) => point.host.storageUsedPercent),
      sparkMax: 1,
      detail: host.storage.path,
    })
  }

  const gpu = host.gpu[0]
  if (gpu) {
    readings.push({
      id: 'gpu',
      label: t('gpu'),
      icon: MonitorCog,
      value: percentLabel(gpu.utilisation) ?? gpu.model,
      ratio: gpu.utilisation,
      tone: toneOf(gpu.utilisation, 'gpu'),
      spark: points.map((point) => point.host.gpuUtilisation),
      sparkMax: 1,
      detail: [gpu.model, gpu.vramBytes ? `${t('gpuMemory')} ${format.bytes(gpu.vramBytes)}` : null]
        .filter(Boolean)
        .join(' · '),
    })
  }

  if (host.temperatureCelsius !== null) {
    readings.push({
      id: 'temperature',
      label: t('temperature'),
      icon: Thermometer,
      value: `${Math.round(host.temperatureCelsius)}°C`,
      // Scaled against the threshold it matters at, not against 100.
      ratio: Math.min(1, host.temperatureCelsius / 100),
      tone: toneOf(host.temperatureCelsius, 'temperature'),
      spark: points.map((point) => point.host.temperatureCelsius),
      sparkMax: 100,
    })
  }

  const battery = host.battery
  if (battery) {
    const state = battery.charging ? t('charging') : battery.acConnected ? t('onMains') : t('onBattery')
    readings.push({
      id: 'battery',
      label: t('battery'),
      icon: battery.charging || battery.acConnected ? BatteryCharging : BatteryMedium,
      value: percentLabel(battery.percent) ?? '—',
      ratio: battery.percent,
      // On mains, charge is information rather than pressure.
      tone: battery.acConnected ? 'ok' : toneOf(battery.percent, 'battery'),
      detail: [
        state,
        battery.minutesRemaining !== null
          ? t('remaining', { time: format.uptime(battery.minutesRemaining * 60) })
          : null,
        battery.cycleCount !== null ? t('cycles', { count: battery.cycleCount }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })
  }

  if (host.load) {
    const cores = host.cpu.logicalCores
    const perCore = cores && cores > 0 ? host.load.five / cores : null
    readings.push({
      id: 'load',
      label: t('loadLabel'),
      icon: Gauge,
      value: `${host.load.one.toFixed(2)} · ${host.load.five.toFixed(2)} · ${host.load.fifteen.toFixed(2)}`,
      ratio: perCore === null ? null : Math.min(1, perCore / 4),
      tone: toneOf(perCore, 'load'),
      detail: perCore === null ? undefined : t('loadPerCore', { value: perCore.toFixed(2) }),
    })
  }

  return readings
}

/**
 * One measurement in the strip: the label, the number in the tone the number
 * deserves, a hairline of a bar. The last half hour, and whatever else there is
 * to say about it, wait in the tooltip: the strip is for the glance.
 */
function ReadingCell({ reading, minutes }: { reading: Reading; minutes: number }) {
  const { t } = useTranslation('overview', { keyPrefix: 'host' })
  const Icon = reading.icon
  const hasSpark = reading.spark?.some((value) => value !== null)
  const cell = (
    <div className="min-w-0 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-2xs text-subtle">
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{reading.label}</span>
      </div>
      <div
        className={cn('mt-0.5 truncate text-sm font-semibold tabular-nums', resourceTextClass(reading.tone))}
        title={reading.value}
      >
        {reading.value}
      </div>
      <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-fill-strong" aria-hidden>
        {reading.ratio !== null ? (
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', resourceBarClass(reading.tone))}
            style={{ width: `${Math.min(100, Math.max(2, reading.ratio * 100))}%` }}
          />
        ) : null}
      </div>
    </div>
  )
  if (!reading.detail && !hasSpark) return cell
  return (
    <Tooltip
      side="bottom"
      label={
        <span className="block min-w-40">
          {reading.detail ? <span className="block">{reading.detail}</span> : null}
          {hasSpark && reading.spark ? (
            <>
              <span className="mt-1 block text-2xs opacity-70">{t('history', { label: reading.label, minutes })}</span>
              <Sparkline
                values={reading.spark}
                tone={reading.tone}
                max={reading.sparkMax}
                className="mt-1 h-6 w-full"
              />
            </>
          ) : null}
        </span>
      }
    >
      <div tabIndex={0} className="min-w-0 rounded-sm focus-ring">
        {cell}
      </div>
    </Tooltip>
  )
}

/** The strip's own shape while the first snapshot is on its way. */
export function HostSummarySkeleton() {
  return (
    <div
      className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line-subtle sm:grid-cols-3 lg:grid-cols-5"
      aria-hidden
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="bg-surface px-3 py-1.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="mt-1.5 h-3.5 w-20" />
          <Skeleton className="mt-1.5 h-0.5 w-full" />
        </div>
      ))}
    </div>
  )
}

const KIND_ICON: Record<HostKind, ComponentType<{ className?: string }>> = {
  notebook: Laptop,
  desktop: Monitor,
  server: Server,
  vm: Box,
}

export function hostKindOf(host: HostMetrics): HostKind | null {
  return host.kind
}

/**
 * The name at the top: the commercial name without its parenthesis
 * ("MacBook Pro", not "MacBook Pro (14-inch, M3 Pro, Nov 2023)"), else the
 * hostname. The whole name waits in the title attribute.
 */
export function hostDisplayName(host: HostMetrics): string | null {
  if (host.productName) return host.productName.replace(/\s*\(.*\)\s*$/, '') || host.productName
  return host.hostname
}

/**
 * The facts under the name, none of them said twice: the hostname when the
 * product name took its place, the provider or hypervisor of a VM, the
 * model, the OS, the architecture, and how long it has been up.
 */
export function hostFacts(host: HostMetrics, kind: HostKind | null, uptime: string | null): string[] {
  const os = [host.distro ?? host.platform, host.version].filter(Boolean).join(' ')
  return [
    host.productName ? host.hostname : null,
    kind === 'vm' ? host.manufacturer : null,
    host.model && host.model !== host.productName ? host.model : null,
    os || null,
    host.architecture,
    uptime,
  ].filter((value): value is string => Boolean(value))
}

/**
 * The top of the Overview: not the page's name but the machine's. What it is
 * on one line, the facts about it on the next, and beside them whether the
 * gateway is up, whether the host has room, and how fresh that is. The route
 * name stays as the page's heading for a screen reader; a person reads the
 * host.
 */
export function HostHeader({
  title,
  data,
  pending,
  pressure,
  gateway,
  className,
}: {
  /** The route's name, the page's h1 for assistive technology. */
  title: string
  /** Undefined while the first snapshot is on its way. */
  data: MetricsCurrent | undefined
  pending: boolean
  /** The server's verdict. Absent on a panel that cannot compute one. */
  pressure?: HostPressure
  gateway: { up: boolean; label: string }
  className?: string
}) {
  const { t } = useTranslation('overview', { keyPrefix: 'host' })
  const format = useFormat()
  const host = data?.host ?? null
  const kind = host ? hostKindOf(host) : null
  const Icon = kind ? KIND_ICON[kind] : Server
  const name = host ? (hostDisplayName(host) ?? t('title')) : null
  const facts = host
    ? hostFacts(
        host,
        kind,
        host.uptimeSeconds !== null ? t('up', { time: format.uptime(host.uptimeSeconds) }) : null,
      ).join(' · ')
    : ''

  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5', className)}>
      <h1 className="sr-only">{title}</h1>

      <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
        {host ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink" title={host.productName ?? undefined}>
              {name}
              {kind ? <span className="font-normal text-muted"> · {t(`kind.${kind}`)}</span> : null}
            </p>
            {facts ? (
              <p className="truncate text-xs text-subtle tabular-nums" title={facts}>
                {facts}
              </p>
            ) : null}
          </div>
        ) : pending ? (
          <div className="min-w-0 space-y-1.5 pt-0.5" aria-hidden>
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted">{t('unavailable')}</p>
            <p className="truncate text-xs text-subtle">{t('unavailableHint')}</p>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <StatusIndicator tone={gateway.up ? 'ok' : 'danger'} emphasis="ink">
          {gateway.label}
        </StatusIndicator>
        {data ? <HostStatus data={data} pressure={pressure} /> : null}
      </div>
    </header>
  )
}

/**
 * Whether the host has room, and how fresh that is. The reasons wait in a
 * tooltip; the strip below says which number, and the attention band says
 * what to do.
 */
function HostStatus({ data, pressure }: { data: MetricsCurrent; pressure?: HostPressure }) {
  const { t } = useTranslation('overview', { keyPrefix: 'host' })
  const { t: tp } = useTranslation('overview', { keyPrefix: 'pressure' })
  const format = useFormat()

  const level = pressure?.measured ? pressure.level : null
  const reasons = pressureReasons(pressure, tp as never)
  const verdict = level === null ? tp('unmeasured') : tp(level)
  const verdictHint =
    level === null
      ? tp('unmeasuredHint')
      : reasons.length > 0
        ? tp('because', { reasons: reasons.join(', ') })
        : tp('normalHint')

  const freshness = !data.collectorActive
    ? { tone: 'warn' as const, text: t('collectorInactive') }
    : data.stale && data.ageSeconds !== null
      ? { tone: 'warn' as const, text: t('stale', { age: data.ageSeconds }) }
      : data.collectedAt
        ? { tone: 'neutral' as const, text: t('updated', { time: format.relativeTime(data.collectedAt) }) }
        : null

  return (
    <>
      {data.host ? (
        <Tooltip label={verdictHint} side="bottom">
          <span tabIndex={0} className="inline-flex rounded-xs focus-ring">
            <StatusIndicator
              tone={level === null ? 'neutral' : narrowTone(pressureTone(level))}
              emphasis={level !== null && level !== 'normal' ? 'tone' : 'muted'}
            >
              {tp('label')} · {verdict}
            </StatusIndicator>
          </span>
        </Tooltip>
      ) : null}
      {freshness ? (
        <span className={cn(freshness.tone === 'warn' ? 'text-warn' : 'text-subtle')}>{freshness.text}</span>
      ) : null}
    </>
  )
}

/** The reasons a host is under pressure, said in the operator's language. */
export function pressureReasons(
  pressure: HostPressure | undefined,
  tp: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  return (pressure?.reasons ?? []).map((reason) =>
    tp(`reason.${reason.resource}`, {
      value:
        reason.resource === 'temperature'
          ? `${Math.round(reason.value)}°C`
          : reason.resource === 'load'
            ? reason.value.toFixed(2)
            : `${Math.round(reason.value * 100)}%`,
    }),
  )
}

/**
 * The measurements, as one strip of cells divided by hairlines, with the
 * host's facts folded underneath for the moment they are needed.
 */
export function HostReadings({
  data,
  history,
  className,
}: {
  data: MetricsCurrent
  history?: MetricsHistory
  className?: string
}) {
  const { t } = useTranslation('overview', { keyPrefix: 'host' })
  const format = useFormat()
  const [open, setOpen] = useState(false)
  const host = data.host
  if (!host) return null
  const readings = readingsFor(host, history, format, t as never)

  return (
    <section
      aria-label={t('summary')}
      className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}
    >
      <div className="flex items-stretch">
        <div className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr [&>*]:border-r [&>*]:border-b [&>*]:border-line-subtle lg:[&>*]:border-b-0 lg:[&>*:last-child]:border-r-0">
          {readings.map((reading) => (
            <ReadingCell key={reading.id} reading={reading} minutes={HISTORY_MINUTES} />
          ))}
        </div>
        <div className="flex shrink-0 items-center border-l border-line-subtle px-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-controls="host-details"
            onClick={() => setOpen((current) => !current)}
            title={open ? t('hideDetails') : t('showDetails')}
          >
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
            <span className="sr-only">{open ? t('hideDetails') : t('showDetails')}</span>
          </Button>
        </div>
      </div>

      {open ? (
        <dl
          id="host-details"
          className="grid gap-x-6 gap-y-1 border-t border-line px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-4"
        >
          <Fact label={t('system')}>
            {[host.distro ?? host.platform, host.version, host.kernel].filter(Boolean).join(' · ') || '—'}
          </Fact>
          <Fact label={t('architecture')}>
            {host.architecture ?? '—'}
            {host.virtual ? ` · ${t('virtual')}` : ''}
          </Fact>
          <Fact label={t('cpu')}>{host.cpu.brand ?? '—'}</Fact>
          {host.storage ? (
            <Fact label={t('storage.path')}>
              <span className="font-mono break-all">{host.storage.path}</span>
            </Fact>
          ) : null}
          {host.swapTotalBytes !== null ? (
            <Fact
              label={t('swap')}
            >{`${format.bytes(host.swapUsedBytes)} / ${format.bytes(host.swapTotalBytes)}`}</Fact>
          ) : null}
          {data.runtime ? <Fact label={t('runtime.label')}>{t(`runtime.${data.runtime.name}`)}</Fact> : null}
          {host.gpu.map((gpu) => (
            <Fact key={gpu.model} label={t('gpu')}>
              {[gpu.model, gpu.vramBytes ? format.bytes(gpu.vramBytes) : null].filter(Boolean).join(' · ')}
            </Fact>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{children}</dd>
    </div>
  )
}
