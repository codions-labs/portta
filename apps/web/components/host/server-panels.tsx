'use client'

// What the server is, as a whole: how much of it is in use, whose that use is, and
// the facts that say which machine this is. The numbers are the server's, never a
// project's, so a person can tell the projects from everything else running there.

import Link from 'next/link'
import type { HostMetrics, MetricsCurrent } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Fact, readingsFor } from '@/components/host-summary'
import { Callout, ReadingCard } from '@/components/shell-bits'
import { Card, CardHeader } from '@/components/ui/card'
import { useCan } from '@/lib/permissions'
import { useDockerHost, useMetricsCurrent, useMetricsHistory } from '@/lib/queries'
import { percentLabel, resourceTextClass, resourceTone } from '@/lib/resources'
import { projectsOfUsed, type UsageKind, type UsageSplit, usageSplit } from '@/lib/server-usage'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

/** The colours of the four parts, shared by the bars, their legends and the totals. */
const PART = {
  projects: 'bg-link',
  portta: 'bg-ink',
  system: 'bg-subtle',
  free: 'bg-surface-2 ring-1 ring-line ring-inset',
} as const

type Part = keyof typeof PART

function useAmount(kind: UsageKind) {
  const format = useFormat()
  return (value: number) =>
    kind === 'cpu'
      ? value.toLocaleString(format.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : value === 0
        ? '0 B'
        : format.bytes(value)
}

function parts(split: UsageSplit): Array<{ id: Part; value: number }> {
  const known: Array<{ id: Part; value: number }> =
    split.projects === null
      ? [{ id: 'system', value: split.used }]
      : [
          { id: 'projects', value: split.projects },
          { id: 'portta', value: split.portta ?? 0 },
          { id: 'system', value: split.system ?? 0 },
        ]
  return [...known, { id: 'free', value: split.free }]
}

function SplitBar({ split, label }: { split: UsageSplit; label: string }) {
  return (
    <div role="img" aria-label={label} className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
      {parts(split).map(({ id, value }) =>
        value > 0 ? (
          <span
            key={id}
            className={cn('block h-full min-w-[3px]', PART[id])}
            style={{ width: `${(value / split.total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  )
}

function Legend({ split }: { split: UsageSplit }) {
  const { t } = useTranslation('host', { keyPrefix: 'health.usage.part' })
  const amount = useAmount(split.kind)
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
      {parts(split)
        .filter(({ id }) => id !== 'free')
        .map(({ id, value }) => (
          <li key={id} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-xs', PART[id])} aria-hidden />
            {t(id)} <b className="font-semibold text-ink tabular-nums">{amount(value)}</b>
          </li>
        ))}
    </ul>
  )
}

function UsageCard({ kind, split, points }: { kind: UsageKind; split: UsageSplit; points: Array<number | null> }) {
  const { t } = useTranslation('host', { keyPrefix: 'health.usage' })
  const amount = useAmount(kind)
  const ratio = split.used / split.total
  const tone = resourceTone(ratio, kind === 'disk' ? 'storage' : kind)
  const detail =
    kind === 'cpu'
      ? t('ofCores', { used: amount(split.used), total: amount(split.total) })
      : t('ofTotal', { used: amount(split.used), total: amount(split.total) })
  const label = t(kind)
  return (
    <ReadingCard
      label={label}
      value={percentLabel(ratio) ?? '—'}
      unit={t('inUse')}
      detail={detail}
      tone={resourceTextClass(tone)}
      points={points}
      max={1}
      footnote={t('freeOf', { free: amount(split.free) })}
    >
      <SplitBar
        split={split}
        label={parts(split)
          .map(({ id, value }) => `${t(`part.${id}`)} ${percentLabel(value / split.total)}`)
          .join(', ')}
      />
      {split.projects === null ? <p className="mt-2 text-xs text-muted">{t('diskWhole')}</p> : <Legend split={split} />}
    </ReadingCard>
  )
}

/** What is read on top of the three that are split: how busy it is, and what only some machines have. */
const SPLIT = new Set(['cpu', 'memory', 'storage'])

export function UsageCards() {
  const { t } = useTranslation('host', { keyPrefix: 'health' })
  const { t: to } = useTranslation('overview', { keyPrefix: 'host' })
  const format = useFormat()
  const metrics = useMetricsCurrent()
  const history = useMetricsHistory('30m')
  const host = metrics.data?.host
  if (!host) return null
  const projects = metrics.data?.projects ?? []
  const points = history.data?.points ?? []
  const memory = usageSplit('memory', host, projects)
  const cpu = usageSplit('cpu', host, projects)
  const disk = usageSplit('disk', host, projects, metrics.data?.dockerStorage)
  const others = readingsFor(host, history.data, format, to as never).filter((reading) => !SPLIT.has(reading.id))
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('resources')}>
      {memory ? <UsageCard kind="memory" split={memory} points={points.map((p) => p.host.memoryUsedPercent)} /> : null}
      {cpu ? <UsageCard kind="cpu" split={cpu} points={points.map((p) => p.host.cpuUtilisation)} /> : null}
      {disk ? <UsageCard kind="disk" split={disk} points={points.map((p) => p.host.storageUsedPercent)} /> : null}
      {others.map((reading) => (
        <ReadingCard
          key={reading.id}
          label={reading.label}
          value={reading.value}
          unit={reading.detail}
          points={reading.spark ?? []}
          max={reading.sparkMax}
          footnote={reading.spark ? t('window') : undefined}
        />
      ))}
    </section>
  )
}

export function WholeServerNote() {
  const { t } = useTranslation('host', { keyPrefix: 'health.usage' })
  return <Callout tone="info">{t('note')}</Callout>
}

const SHOWN = 5

/** Who the use belongs to: the projects against everything else on the server. */
export function WhoUsesServer({ kind, onKind }: { kind: UsageKind; onKind: (kind: UsageKind) => void }) {
  const { t } = useTranslation('host', { keyPrefix: 'health.usage' })
  const amount = useAmount(kind)
  const metrics = useMetricsCurrent()
  const host = metrics.data?.host
  if (!host) return null
  const split = usageSplit(kind, host, metrics.data?.projects ?? [], metrics.data?.dockerStorage)
  const total = split?.total ?? 1
  const share = split ? projectsOfUsed(split) : null
  const shown = split?.shares.slice(0, SHOWN) ?? []
  const rest = (split?.shares.length ?? 0) - shown.length
  const restValue = (split?.shares ?? []).slice(SHOWN).reduce((sum, item) => sum + item.value, 0)
  const largest = shown[0]?.value ?? 1
  const percent = (value: number) => {
    const ratio = value / total
    return ratio > 0 && ratio < 0.001
      ? '<0,1%'
      : `${(ratio * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  }

  return (
    <Card aria-labelledby="who-uses">
      <CardHeader
        title={<span id="who-uses">{t('who.title')}</span>}
        description={t('who.description')}
        actions={
          <div
            role="group"
            aria-label={t('who.resource')}
            className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5"
          >
            {(['memory', 'cpu', 'disk'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={kind === item}
                onClick={() => onKind(item)}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium focus-ring',
                  kind === item ? 'bg-surface font-semibold text-link shadow-raised' : 'text-muted hover:text-ink',
                )}
              >
                {t(`kind.${item}`)}
              </button>
            ))}
          </div>
        }
      />
      {split ? (
        <>
          <dl className="grid grid-cols-2 lg:grid-cols-4">
            {parts(split).map(({ id, value }) => (
              <div
                key={id}
                className="flex flex-col gap-0.5 border-r border-line px-5 py-3.5 last:border-r-0 max-lg:odd:border-r max-lg:even:border-r-0"
              >
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <span className={cn('size-2 rounded-xs', PART[id])} aria-hidden />
                  {t(`part.${id}`)}
                </dt>
                <dd className="font-heading text-2xl font-semibold tabular-nums">
                  {percentLabel(value / split.total)}
                </dd>
                <dd className="text-xs text-muted">
                  {amount(value)} · {t('ofWhole', { total: amount(split.total) })}
                </dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-5 py-3 text-sm text-muted">
            {share === null ? (
              t('who.diskNote')
            ) : kind === 'disk' ? (
              <>
                <b className="font-semibold text-ink">{t('who.verdict.disk', { percent: percentLabel(share) })}</b>{' '}
                {t('who.diskScope')}
              </>
            ) : (
              <>
                <b className="font-semibold text-ink">{t(`who.verdict.${kind}`, { percent: percentLabel(share) })}</b>{' '}
                {t('who.rest', { percent: percentLabel(1 - share) })}
              </>
            )}
          </p>
          {share !== null ? (
            <>
              <p className="border-t border-line px-5 pt-3 pb-1 text-xs font-medium tracking-[0.12em] text-subtle uppercase">
                {t('who.list')}
              </p>
              <ul>
                {shown.map((item) => (
                  <li key={item.environment}>
                    <Link
                      href={`/environments/${encodeURIComponent(item.environment)}`}
                      className="grid grid-cols-[minmax(7rem,1.2fr)_minmax(0,3fr)_auto] items-center gap-x-4 border-t border-line px-5 py-2 text-sm hover:bg-fill focus-ring"
                    >
                      <b className="min-w-0 truncate font-semibold text-ink">{item.name}</b>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full bg-link"
                          style={{ width: `${(item.value / largest) * 100}%` }}
                        />
                      </span>
                      <span className="text-right tabular-nums">
                        <b className="font-semibold text-ink">{percent(item.value)}</b>{' '}
                        <span className="text-xs text-muted">{amount(item.value)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
                {rest > 0 ? (
                  <li className="grid grid-cols-[minmax(7rem,1.2fr)_minmax(0,3fr)_auto] items-center gap-x-4 border-t border-line px-5 py-2 text-sm text-muted">
                    <span>{t('who.more', { count: rest })}</span>
                    <span />
                    <span className="text-right tabular-nums">
                      <b className="font-semibold">{percent(restValue)}</b>{' '}
                      <span className="text-xs">{amount(restValue)}</span>
                    </span>
                  </li>
                ) : null}
                {shown.length === 0 ? (
                  <li className="border-t border-line px-5 py-3 text-sm text-muted">{t('who.empty')}</li>
                ) : null}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <p className="border-t border-line px-5 py-3 text-sm text-muted">{t('who.unmeasured')}</p>
      )}
    </Card>
  )
}

function zoneOffset(minutes: number | null | undefined): string | null {
  if (minutes == null) return null
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  const two = (value: number) => String(value).padStart(2, '0')
  return `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
}

/** The server's own clock: the time it reads and the zone it was set to. */
export function ServerClock({ host, now }: { host: HostMetrics; now: number }) {
  const { t } = useTranslation('host', { keyPrefix: 'health.clock' })
  const format = useFormat()
  const zone = host.timezone ?? null
  let clock: string | null = null
  let day: string | null = null
  if (zone) {
    try {
      clock = new Intl.DateTimeFormat(format.locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(now)
      day = new Intl.DateTimeFormat(format.locale, {
        timeZone: zone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(now)
    } catch {
      clock = null
    }
  }
  const browserOffset = -new Date(now).getTimezoneOffset()
  const same = host.utcOffsetMinutes != null && host.utcOffsetMinutes === browserOffset
  return (
    <Card aria-labelledby="server-clock">
      <CardHeader title={<span id="server-clock">{t('title')}</span>} />
      <div className="space-y-1.5 px-5 py-4">
        {clock ? (
          <p className="font-heading text-3xl font-semibold tabular-nums">
            {clock} <span className="font-sans text-sm font-medium text-muted">{day}</span>
          </p>
        ) : (
          <p className="text-sm text-muted">{t('unknown')}</p>
        )}
        {zone ? (
          <p className="text-sm text-muted">
            <span className="font-mono">{zone}</span>
            {zoneOffset(host.utcOffsetMinutes) ? ` · ${zoneOffset(host.utcOffsetMinutes)}` : ''}
          </p>
        ) : null}
        {clock ? <p className="pt-1 text-xs text-subtle">{same ? t('sameAsYou') : t('differsFromYou')}</p> : null}
      </div>
    </Card>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-line px-5 py-4 md:border-r md:last:border-r-0">
      <h3 className="mb-2.5 text-xs font-semibold tracking-[0.12em] text-subtle uppercase">{title}</h3>
      <dl className="grid gap-y-1.5 text-sm">{children}</dl>
    </div>
  )
}

export function ServerDetails({ data, now }: { data: MetricsCurrent; now: number }) {
  const { t } = useTranslation('host', { keyPrefix: 'health.server' })
  const { t: to } = useTranslation('overview', { keyPrefix: 'host' })
  const format = useFormat()
  const docker = useDockerHost(useCan('docker:read'))
  const host = data.host
  if (!host) return null
  const engine = docker.data?.engine
  const system = [host.distro ?? host.platform, host.version].filter(Boolean).join(' ')
  const since = host.uptimeSeconds != null ? new Date(now - host.uptimeSeconds * 1000) : null
  return (
    <Card aria-labelledby="server-details">
      <CardHeader title={<span id="server-details">{t('title')}</span>} />
      <div className="grid md:grid-cols-3">
        <Group title={t('system')}>
          <Fact label={t('name')}>{host.hostname ?? data.instance.hostname ?? '—'}</Fact>
          <Fact label={t('os')}>{system || '—'}</Fact>
          <Fact label={t('kernel')}>
            <span className="font-mono text-xs">{host.kernel ?? '—'}</span>
          </Fact>
          <Fact label={t('architecture')}>{host.architecture ?? '—'}</Fact>
          <Fact label={t('type')}>{host.virtual ? to('virtual') : host.kind ? to(`kind.${host.kind}`) : '—'}</Fact>
          {host.uptimeSeconds != null ? (
            <Fact label={t('up')}>
              {since ? `${since.toLocaleDateString(format.locale, { day: 'numeric', month: 'short' })} · ` : ''}
              {format.uptime(host.uptimeSeconds)}
            </Fact>
          ) : null}
        </Group>
        <Group title={t('hardware')}>
          <Fact label={t('cpu')}>
            {[host.cpu.brand, host.cpu.logicalCores != null ? to('cores', { count: host.cpu.logicalCores }) : null]
              .filter(Boolean)
              .join(' · ') || '—'}
          </Fact>
          <Fact label={t('memory')}>
            {host.memoryTotalBytes != null ? format.bytes(host.memoryTotalBytes) : '—'}
            {host.swapTotalBytes != null
              ? ` · ${t('swap', { used: format.bytes(host.swapUsedBytes), total: format.bytes(host.swapTotalBytes) })}`
              : ''}
          </Fact>
          {host.storage ? (
            <Fact label={t('disk')}>
              {format.bytes(host.storage.totalBytes)}
              {host.storage.filesystem ? ` · ${host.storage.filesystem}` : ''}
              {host.storage.mount ? ` · ${host.storage.mount}` : ''}
            </Fact>
          ) : null}
          <Fact label={t('gpu')}>
            {host.gpu.length > 0
              ? host.gpu
                  .map((gpu) =>
                    [gpu.model, gpu.vramBytes ? format.bytes(gpu.vramBytes) : null].filter(Boolean).join(' · '),
                  )
                  .join(', ')
              : t('none')}
          </Fact>
          {host.temperatureCelsius != null ? (
            <Fact label={t('temperature')}>{Math.round(host.temperatureCelsius)} °C</Fact>
          ) : null}
        </Group>
        <Group title={t('environment')}>
          <Fact label={t('timezone')}>
            {host.timezone ? (
              <>
                {host.timezone}
                {zoneOffset(host.utcOffsetMinutes) ? ` (${zoneOffset(host.utcOffsetMinutes)})` : ''}
              </>
            ) : (
              <span className="text-subtle">{t('unreported')}</span>
            )}
          </Fact>
          {engine ? (
            <>
              <Fact label={t('docker')}>
                {engine.version} (API {engine.apiVersion})
              </Fact>
              <Fact label={t('dockerResources')}>
                {engine.cpus} CPU · {format.bytes(engine.memoryBytes)}
              </Fact>
            </>
          ) : null}
          {data.runtime ? <Fact label={to('runtime.label')}>{to(`runtime.${data.runtime.name}`)}</Fact> : null}
          {host.storage ? (
            <Fact label={t('portta')}>
              <span className="font-mono text-xs break-all">{host.storage.path}</span>
            </Fact>
          ) : null}
        </Group>
      </div>
    </Card>
  )
}
