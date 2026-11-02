'use client'

// The overview tab: how much this Project uses, environment by environment and
// service by service, and how to reach each environment.

import Link from 'next/link'
import type { Environment, Project, ProjectEnvironment } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvironmentRow } from '@/components/entities/environment-row'
import { Empty, ReadingCard } from '@/components/shell-bits'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { environmentHealth, healthTone } from '@/lib/health'
import { useCan } from '@/lib/permissions'
import { useEnvironments, useExposure, useMetricsCurrent, useMetricsHistory } from '@/lib/queries'
import { percentLabel } from '@/lib/resources'
import { useFormat } from '@/lib/use-format'

/** What the collector keeps: anything longer than an hour is a promise it could not honour. */
const WINDOWS = ['15m', '30m', '1h'] as const
type HistoryWindow = (typeof WINDOWS)[number]

export function ProjectOverview({ project }: { project: Project; readOnly?: boolean }) {
  const { t } = useTranslation('projects')
  const { bytes, storage, uptime } = useFormat()
  const mayRead = useCan('access:read')
  const environments = useEnvironments(true)
  const exposure = useExposure(mayRead)
  const metrics = useMetricsCurrent()
  const [window, setWindow] = useState<HistoryWindow>('30m')
  const history = useMetricsHistory(window)
  const [chosen, setChosen] = useState<string | null>(null)

  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  const adopted = project.environments
    .map((entry) => known.get(entry.environment))
    .filter((environment): environment is Environment => environment !== undefined)
  const selected = chosen ?? adopted.find((environment) => environment.runningCount > 0)?.name ?? adopted[0]?.name
  const environment = selected ? known.get(selected) : undefined
  const measured = (metrics.data?.projects ?? []).find((entry) => entry.composeProject === selected)
  const stored = (metrics.data?.dockerStorage?.projects ?? [])
    .filter((entry) => entry.composeProject === selected)
    .reduce((sum, entry) => sum + entry.volumeBytes + entry.layerBytes, 0)
  const points = (history.data?.points ?? []).map(
    (point) => point.projects.find((entry) => entry.id === measured?.id) ?? null,
  )
  const memoryLimit = measured?.containers.reduce<number | null>(
    (sum, container) => (container.memoryLimitBytes === null ? sum : (sum ?? 0) + container.memoryLimitBytes),
    null,
  )

  if (project.environments.length === 0) {
    return (
      <Card>
        <Empty title={t('environments.empty')} hint={t('environments.emptyHint')} />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('environments.title')}>
          {adopted.length > 1
            ? adopted.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  aria-pressed={entry.name === selected}
                  onClick={() => setChosen(entry.name)}
                  className={
                    entry.name === selected
                      ? 'flex h-8.5 items-center gap-2 rounded-full bg-accent px-3 text-sm font-medium text-accent-fg focus-ring'
                      : 'flex h-8.5 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-medium text-muted transition-colors duration-100 hover:bg-surface-2 hover:text-ink focus-ring'
                  }
                >
                  {entry.overrides?.displayName ?? entry.name}
                </button>
              ))
            : null}
        </div>
        <Segmented
          label={t('overview.period')}
          value={window}
          onChange={setWindow}
          options={WINDOWS.map((value) => ({ value, label: t(`overview.window.${value}`) }))}
        />
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('overview.resources')}>
        <ReadingCard
          label={t('overview.cpu')}
          value={percentLabel(measured?.cpuUtilisation ?? null) ?? '—'}
          points={points.map((point) => point?.cpuUtilisation ?? null)}
          max={1}
        />
        <ReadingCard
          label={t('overview.memory')}
          value={measured?.memoryUsedBytes == null ? '—' : bytes(measured.memoryUsedBytes)}
          unit={memoryLimit ? t('overview.ofLimit', { limit: bytes(memoryLimit) }) : undefined}
          points={points.map((point) => point?.memoryUsedBytes ?? null)}
        />
        {metrics.data?.host?.gpuMemory ? (
          <ReadingCard
            label={t('overview.gpu')}
            value={bytes(measured?.gpuMemoryBytes ?? 0)}
            unit={t('overview.ofGpu', { total: bytes(metrics.data.host.gpuMemory.totalBytes) })}
            points={[]}
          />
        ) : null}
        {stored ? (
          <ReadingCard label={t('overview.disk')} value={storage(stored)} unit={t('overview.diskHint')} points={[]} />
        ) : null}
        <ReadingCard
          label={t('overview.services')}
          value={environment ? String(environment.runningCount) : '—'}
          unit={environment ? t('overview.ofServices', { total: environment.serviceCount }) : undefined}
          points={[]}
        />
        <ReadingCard
          label={t('overview.uptime')}
          value={environment?.uptimeSeconds == null ? '—' : uptime(environment.uptimeSeconds)}
          points={[]}
        />
      </section>
      {metrics.data && measured === undefined ? (
        <p className="text-sm text-subtle">{t('overview.noMeasurement')}</p>
      ) : null}

      <div className="flex flex-wrap items-start gap-6">
        <Card className="min-w-0 flex-[999_1_32rem]">
          <CardHeader
            title={t('environments.title')}
            actions={
              <Link
                className="rounded-xs text-sm text-link hover:underline focus-ring"
                href={`/projects/${encodeURIComponent(project.slug)}/environments`}
              >
                {t('overview.manageEnvironments')}
              </Link>
            }
          />
          <ul>
            {project.environments.map((entry) => {
              const live = known.get(entry.environment)
              return live ? (
                <EnvironmentRow key={entry.environment} environment={live} exposure={exposure.data} />
              ) : (
                <AdoptedRow key={entry.environment} environment={entry} />
              )
            })}
          </ul>
        </Card>

        <Card className="min-w-0 flex-[1_1_22rem]">
          <CardHeader title={t('overview.byService')} />
          {measured && measured.containers.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>{t('overview.service')}</Th>
                  <Th>{t('overview.cpu')}</Th>
                  <Th>{t('overview.memory')}</Th>
                </tr>
              </thead>
              <tbody>
                {measured.containers.map((container) => (
                  <Tr key={container.id}>
                    <Td className="font-semibold text-ink">{container.service ?? container.name}</Td>
                    <Td className="tabular-nums">{percentLabel(container.cpuUtilisation) ?? '—'}</Td>
                    <Td className="tabular-nums">
                      {container.memoryUsedBytes === null ? '—' : bytes(container.memoryUsedBytes)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-5 py-4 text-sm text-subtle">{t('overview.noMeasurement')}</p>
          )}
        </Card>
      </div>
    </div>
  )
}

/**
 * The adopted environment when the list does not carry it in full. One with no
 * services at all is a remembered one (its containers are gone), which the link
 * carries no presence for: "0/0 running" would be the wrong word.
 */
export function AdoptedRow({ environment }: { environment: ProjectEnvironment }) {
  const { t } = useTranslation('projects')
  const { t: te } = useTranslation('environments')
  const health = environmentHealth(environment)
  const remembered = environment.serviceCount === 0 && !environment.running
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line-subtle px-5 py-2.5 text-sm last:border-b-0">
      <Link
        className="rounded-xs font-medium underline-offset-2 hover:underline focus-ring"
        href={`/environments/${encodeURIComponent(environment.environment)}`}
      >
        {environment.environment}
      </Link>
      {remembered ? (
        <Badge tone="outline">{te('presence.remembered')}</Badge>
      ) : (
        <StatusIndicator tone={healthTone(health)}>
          {t('running', { running: environment.runningCount, total: environment.serviceCount })}
        </StatusIndicator>
      )}
      {environment.unhealthyCount > 0 ? (
        <Badge tone="danger">{t('detail.unhealthyCount', { count: environment.unhealthyCount })}</Badge>
      ) : null}
      <span className="text-xs text-subtle">{t(sourceKey(environment.source))}</span>
    </div>
  )
}

export function sourceKey(
  source: ProjectEnvironment['source'],
): 'detail.sourceReason.label' | 'detail.sourceReason.path' | 'detail.sourceReason.manual' {
  return source === 'label'
    ? 'detail.sourceReason.label'
    : source === 'path'
      ? 'detail.sourceReason.path'
      : 'detail.sourceReason.manual'
}
