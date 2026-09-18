'use client'

import type { ContainerResourceMetrics, ContainerSummary, MetricsCurrent } from 'portta-contracts'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Column } from '../../lib/table.ts'
import { useFormat } from '../../lib/use-format.ts'
import { ContainerActions } from '../container-actions.tsx'
import { Mono } from '../copy.tsx'
import { ServiceIcon } from '../service-icon.tsx'
import { NoValue } from '../shell-bits.tsx'
import { OwnershipBadge, StateBadge } from '../status.tsx'
import { Badge } from '../ui/badge.tsx'
import { DataTable } from '../ui/data-table.tsx'
import type { TableArrangementHandle } from '../ui/table-arrangement.tsx'
import { ResourceUsage } from './resource-usage.tsx'

/**
 * Every container the collector measured, by id.
 *
 * The Docker inventory and the metrics snapshot are two different reads of the
 * same machine — Docker knows what exists, the collector knows what it costs —
 * and this is the one place they are joined, by container id.
 */
export function containerResources(metrics: MetricsCurrent | undefined): Map<string, ContainerResourceMetrics> {
  const byId = new Map<string, ContainerResourceMetrics>()
  for (const project of metrics?.projects ?? []) {
    for (const container of project.containers) byId.set(container.id, container)
  }
  return byId
}

/**
 * Containers as a table: what they are, whether they are up, what they cost,
 * where they are published and what can be done to them.
 *
 * Deliberately not Portainer. There is no shell, no image management and no
 * volume browser here — the question this page answers is "why is my stack
 * behaving like that", and it answers it with state, health, restarts,
 * resources and logs.
 */
export function ContainerTable({
  containers,
  metrics,
  storageKey,
  onDetails,
  arrangement,
  caption,
  empty,
}: {
  containers: ContainerSummary[]
  metrics?: MetricsCurrent
  storageKey: string
  onDetails: (container: ContainerSummary) => void
  /** Held by the card, so the column menu can sit in its header. */
  arrangement?: TableArrangementHandle
  caption: string
  empty?: ReactNode
}) {
  const { t } = useTranslation('docker')
  const { t: tc } = useTranslation('common')
  const { shortImage, uptime } = useFormat()
  const resources = useMemo(() => containerResources(metrics), [metrics])

  const columns = useMemo<Column<ContainerSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('table.name'),
        pinned: true,
        sortValue: (container) => container.name,
        cell: (container) => (
          <div className="min-w-0">
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 rounded-xs text-left font-medium text-ink underline-offset-2 hover:underline focus-ring"
              onClick={() => onDetails(container)}
            >
              <ServiceIcon tech={container.tech} />
              <span className="truncate">{container.name}</span>
            </button>
            <div className="mt-0.5 flex items-center gap-1">
              <OwnershipBadge ownership={container.ownership} />
              {container.oneOff ? <Badge tone="outline">{tc('oneOff')}</Badge> : null}
            </div>
          </div>
        ),
      },
      {
        id: 'state',
        header: t('table.state'),
        sortValue: (container) => `${container.state}:${container.health}`,
        cell: (container) => (
          <div className="flex flex-wrap items-center gap-1">
            <StateBadge state={container.state} health={container.health} completed={container.completed} />
            {container.restartCount > 0 ? (
              <Badge tone={container.restartCount > 3 ? 'danger' : 'warn'}>
                {t('table.restarts', { count: container.restartCount })}
              </Badge>
            ) : null}
            {container.state !== 'running' && container.exitCode !== null && container.exitCode !== 0 ? (
              <Badge tone="danger">{t('table.exitCode', { code: container.exitCode })}</Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: 'resources',
        header: t('table.resources'),
        sortValue: (container) => resources.get(container.id)?.memoryUsedBytes ?? null,
        cell: (container) => {
          const measured = resources.get(container.id)
          return measured ? (
            <ResourceUsage
              cpu={measured.cpuUtilisation}
              memoryBytes={measured.memoryUsedBytes}
              memoryLimitBytes={measured.memoryLimitBytes}
              className="text-2xs"
            />
          ) : (
            <NoValue />
          )
        },
      },
      {
        id: 'environment',
        header: t('table.project'),
        priority: 2,
        sortValue: (container) => container.environment,
        cell: (container) => (
          <span className="text-xs text-muted">
            {container.environment ? (
              <a
                className="rounded-xs underline-offset-2 hover:text-ink hover:underline focus-ring"
                href={`/environments/${encodeURIComponent(container.environment)}`}
              >
                {container.environment}
              </a>
            ) : (
              <NoValue />
            )}
            {container.service ? <span className="text-subtle"> · {container.service}</span> : null}
          </span>
        ),
      },
      {
        id: 'image',
        header: t('table.image'),
        priority: 2,
        sortValue: (container) => container.image,
        cell: (container) => (
          <Mono kind="text" title={container.image}>
            {shortImage(container.image)}
          </Mono>
        ),
      },
      {
        id: 'ports',
        header: t('table.ports'),
        priority: 3,
        sortValue: (container) => container.ports[0]?.hostPort ?? null,
        cell: (container) =>
          container.ports.length > 0 ? (
            <Mono kind="port">{container.ports.map((port) => `${port.ip}:${port.hostPort}`).join(' ')}</Mono>
          ) : (
            <NoValue />
          ),
      },
      {
        id: 'networks',
        header: t('networks'),
        priority: 3,
        defaultHidden: true,
        sortValue: (container) => container.networks.join(','),
        cell: (container) =>
          container.networks.length > 0 ? <Mono value={container.networks.join(', ')} /> : <NoValue />,
      },
      {
        id: 'uptime',
        header: t('table.uptime'),
        align: 'right',
        priority: 2,
        sortValue: (container) => container.uptimeSeconds,
        cell: (container) => <span className="text-xs tabular-nums text-muted">{uptime(container.uptimeSeconds)}</span>,
      },
      {
        id: 'actions',
        header: '',
        srHeader: t('table.actions'),
        pinned: true,
        align: 'right',
        cell: (container) => (
          <div className="flex justify-end">
            <ContainerActions container={container} onShowDetails={() => onDetails(container)} />
          </div>
        ),
      },
    ],
    [onDetails, resources, shortImage, t, tc, uptime],
  )

  return (
    <DataTable
      rows={containers}
      columns={columns}
      rowKey={(container) => container.id}
      rowLabel={(container) => container.name}
      storageKey={storageKey}
      arrangement={arrangement}
      caption={caption}
      empty={empty}
    />
  )
}
