'use client'

// How the machine is doing: what it reads now, who is using it, and what its
// last check found. Problems first; what is fine waits behind one click.

import Link from 'next/link'
import type { Diagnostic } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Fact, HostFacts, readingsFor } from '@/components/host-summary'
import { LearnMore } from '@/components/settings/learn-more'
import { Disclosure, Empty, ErrorBox, Loading, ReadingCard } from '@/components/shell-bits'
import { StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useCan } from '@/lib/permissions'
import {
  useDevelopmentOverview,
  useDockerHost,
  useEnvironmentReport,
  useHostSecurityReport,
  useMetricsCurrent,
  useMetricsHistory,
} from '@/lib/queries'
import { percentLabel } from '@/lib/resources'
import { useFormat } from '@/lib/use-format'

/** How many checks fit before the list is asked for. */
const FIRST_CHECKS = 5
const ORDER: Record<Diagnostic['status'], number> = { fail: 0, warn: 1, info: 2, pass: 3 }
const FOUR = new Set(['cpu', 'memory', 'storage', 'load'])

function dotTone(status: Diagnostic['status']) {
  if (status === 'pass') return 'ok' as const
  if (status === 'warn') return 'warn' as const
  if (status === 'fail') return 'danger' as const
  return 'neutral' as const
}

function Readings() {
  const { t } = useTranslation('host', { keyPrefix: 'health' })
  const { t: to } = useTranslation('overview', { keyPrefix: 'host' })
  const format = useFormat()
  const metrics = useMetricsCurrent()
  const history = useMetricsHistory('30m')
  const host = metrics.data?.host
  if (!host) return null
  const points = history.data?.points ?? []
  const footnote = t('window')
  const number = (value: number) =>
    value.toLocaleString(format.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const others = readingsFor(host, history.data, format, to as never).filter((reading) => !FOUR.has(reading.id))

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('resources')}>
      <ReadingCard
        label={to('cpu')}
        value={percentLabel(host.cpuUtilisation) ?? '—'}
        unit={host.cpu.logicalCores !== null ? to('cores', { count: host.cpu.logicalCores }) : undefined}
        points={points.map((point) => point.host.cpuUtilisation)}
        max={1}
        footnote={footnote}
      />
      <ReadingCard
        label={to('memory')}
        value={host.memoryUsedBytes === null ? '—' : format.bytes(host.memoryUsedBytes)}
        unit={host.memoryTotalBytes !== null ? t('of', { total: format.bytes(host.memoryTotalBytes) }) : undefined}
        points={points.map((point) => point.host.memoryUsedPercent)}
        max={1}
        footnote={footnote}
      />
      {host.storage ? (
        <ReadingCard
          label={t('disk')}
          value={format.bytes(host.storage.usedBytes)}
          unit={t('of', { total: format.bytes(host.storage.totalBytes) })}
          points={points.map((point) => point.host.storageUsedPercent)}
          max={1}
          footnote={footnote}
        />
      ) : null}
      {host.load ? (
        <ReadingCard
          label={to('loadLabel')}
          value={number(host.load.one)}
          unit={`${number(host.load.five)} · ${number(host.load.fifteen)}`}
          points={points.map((point) => point.host.load?.one ?? null)}
          footnote={footnote}
        />
      ) : null}
      {others.map((reading) => (
        <ReadingCard
          key={reading.id}
          label={reading.label}
          value={reading.value}
          unit={reading.detail}
          points={reading.spark ?? []}
          max={reading.sparkMax}
          footnote={reading.spark ? footnote : undefined}
        />
      ))}
    </section>
  )
}

function TopConsumers() {
  const { t } = useTranslation('host', { keyPrefix: 'health.top' })
  const { bytes } = useFormat()
  const overview = useDevelopmentOverview()
  const top = overview.data?.resources.topProjects ?? []
  // Against the largest of them: this ranks them, it does not measure the host.
  const largest = Math.max(...top.map((project) => project.memoryUsedBytes ?? 0), 1)

  return (
    <Card>
      <CardHeader title={t('title')} />
      {top.length === 0 ? (
        <Empty title={t('empty')} />
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {top.map((project) => (
            <li key={project.environment}>
              <Link
                href={`/environments/${encodeURIComponent(project.environment)}`}
                className="block rounded-xs focus-ring"
              >
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <b className="min-w-0 truncate font-semibold text-ink">{project.environment}</b>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {[
                      project.cpuUtilisation !== null
                        ? t('cpu', { value: percentLabel(project.cpuUtilisation) })
                        : null,
                      project.memoryUsedBytes !== null ? bytes(project.memoryUsedBytes) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-link"
                    style={{ width: `${Math.round(((project.memoryUsedBytes ?? 0) / largest) * 100)}%` }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Checks() {
  const { t } = useTranslation('settings', { keyPrefix: 'environment' })
  const { t: th } = useTranslation('host', { keyPrefix: 'health.checks' })
  const { relativeTime } = useFormat()
  const [all, setAll] = useState(false)
  const report = useEnvironmentReport()
  const security = useHostSecurityReport()
  if (report.isPending || security.isPending) return <Loading />
  if (report.error || security.error) return <ErrorBox error={report.error ?? security.error} />

  const collectedAt = report.data?.collectedAt ?? null
  const checks = [...(report.data?.checks ?? []), ...(security.data?.collectedAt ? security.data.checks : [])].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status],
  )
  const shown = all ? checks : checks.slice(0, FIRST_CHECKS)

  return (
    <Card>
      <CardHeader
        title={th('title')}
        actions={
          collectedAt ? (
            <span className="text-xs text-subtle">
              {report.data?.stale ? t('stale') : t('collected', { when: relativeTime(collectedAt) })}
            </span>
          ) : null
        }
      />
      {collectedAt === null ? (
        <Empty title={t('neverCollected')} hint={t('runCommand')} />
      ) : (
        <>
          <ul>
            {shown.map((check) => {
              const open = all || check.status === 'fail' || check.status === 'warn'
              return (
                <li key={check.id} className="border-t border-line px-5 py-2.5 first:border-t-0">
                  <div className="flex items-center gap-2.5">
                    <StatusDot tone={dotTone(check.status)} label={t(`status.${check.status}`)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{check.title}</span>
                    <span className="shrink-0 text-xs text-subtle">
                      {'tool' in check && check.tool?.version ? check.tool.version : t(`status.${check.status}`)}
                    </span>
                  </div>
                  {open ? (
                    <div className="mt-1 space-y-0.5 pl-[1.125rem] text-xs text-muted">
                      <p>{check.detail}</p>
                      {'rationale' in check && check.rationale ? (
                        <p className="text-subtle">{check.rationale}</p>
                      ) : null}
                      {check.status !== 'pass' && check.fix ? (
                        <p className="text-subtle">
                          {t('fix')}: {check.fix}
                        </p>
                      ) : null}
                      {'docs' in check && check.docs ? <LearnMore citation={check.docs} /> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {checks.length > FIRST_CHECKS ? (
            <div className="border-t border-line px-3 py-1.5">
              <Button variant="ghost" size="sm" onClick={() => setAll((value) => !value)}>
                {all ? th('showFewer') : th('showAll', { count: checks.length })}
              </Button>
            </div>
          ) : null}
          <p className="border-t border-line px-5 py-2 text-xs text-subtle">
            {t('refreshHint')} <Mono kind="command">portta env report</Mono>
          </p>
        </>
      )}
    </Card>
  )
}

function Machine() {
  const { t } = useTranslation('host', { keyPrefix: 'health' })
  const { bytes } = useFormat()
  const metrics = useMetricsCurrent()
  const docker = useDockerHost(useCan('docker:read'))
  if (!metrics.data?.host) return null
  const engine = docker.data?.engine
  return (
    <Disclosure title={t('machine')}>
      <HostFacts data={metrics.data}>
        {engine ? (
          <>
            <Fact label={t('docker')}>
              {engine.version} (API {engine.apiVersion})
            </Fact>
            <Fact label={t('dockerResources')}>
              {engine.cpus} CPU · {bytes(engine.memoryBytes)}
            </Fact>
          </>
        ) : null}
      </HostFacts>
    </Disclosure>
  )
}

export function HostHealthView() {
  return (
    <div className="space-y-5">
      <Readings />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <TopConsumers />
        <Checks />
      </div>
      <Machine />
    </div>
  )
}
