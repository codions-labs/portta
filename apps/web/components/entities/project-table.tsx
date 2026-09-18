'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Archive, Play, RotateCw, Square } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../../lib/api/index.ts'
import type { ProjectListItem } from '../../lib/projects.ts'
import { projectStateRank } from '../../lib/projects.ts'
import type { Column } from '../../lib/table.ts'
import { useFormat } from '../../lib/use-format.ts'
import { Mono } from '../copy.tsx'
import { NoValue } from '../shell-bits.tsx'
import { Badge } from '../ui/badge.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { type BulkAction, DataTable } from '../ui/data-table.tsx'
import type { TableArrangementHandle } from '../ui/table-arrangement.tsx'
import { useToast } from '../ui/toast.tsx'
import { affectedBy, type LifecycleAction, ProjectActionsMenu, type ProjectActionTarget } from './project-actions.tsx'
import { ProjectStateBadge } from './project-card.tsx'
import { ResourceUsage } from './resource-usage.tsx'

function targetOf(item: ProjectListItem): ProjectActionTarget {
  return { slug: item.slug, name: item.name, archived: item.archived, environments: item.environments }
}

type BulkKind = LifecycleAction | 'archive'

/**
 * The Projects table.
 *
 * Replaces the "list" density, which was the card list with the cards taken
 * away: the same badges, one per line, and nothing you could do with them.
 * A table earns its place here because these rows are comparable — how many
 * environments, how much work, how long since anything moved — and comparison
 * is what a list of projects is for.
 */
export function ProjectTable({
  items,
  arrangement,
  empty,
}: {
  items: ProjectListItem[]
  /** Held by the page, so the column menu can sit in its toolbar. */
  arrangement?: TableArrangementHandle
  empty?: ReactNode
}) {
  const { t } = useTranslation('projects')
  const { t: ta } = useTranslation('projects', { keyPrefix: 'actions' })
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [pending, setPending] = useState<{ kind: BulkKind; items: ProjectListItem[]; clear: () => void } | null>(null)
  const [busy, setBusy] = useState(false)

  const columns = useMemo<Column<ProjectListItem>[]>(
    () => [
      {
        id: 'name',
        header: t('table.name'),
        pinned: true,
        sortValue: (item) => item.name,
        cell: (item) => (
          <div className="min-w-0">
            <a
              className="block max-w-72 truncate rounded-xs font-medium text-ink underline-offset-2 hover:underline focus-ring"
              href={`/projects/${encodeURIComponent(item.slug)}`}
            >
              {item.name}
            </a>
            {item.description ? (
              <span className="block max-w-72 truncate text-2xs text-subtle">{item.description}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'state',
        header: t('table.state'),
        sortValue: projectStateRank,
        cell: (item) => <ProjectStateBadge item={item} />,
      },
      {
        id: 'environments',
        header: t('table.environments'),
        align: 'right',
        sortValue: (item) => item.runningEnvironments,
        cell: (item) => (
          <span className="tabular-nums">
            {item.runningEnvironments}
            <span className="text-subtle">/{item.environmentCount}</span>
          </span>
        ),
      },
      {
        id: 'repositories',
        header: t('table.repositories'),
        align: 'right',
        priority: 2,
        sortValue: (item) => item.repositoryCount,
        cell: (item) => <span className="tabular-nums">{item.repositoryCount}</span>,
      },
      {
        id: 'agents',
        header: t('table.agents'),
        align: 'right',
        sortValue: (item) => item.activeSessions,
        cell: (item) =>
          item.activeSessions ? (
            <Badge tone="agent" dot>
              {item.activeSessions}
            </Badge>
          ) : (
            <NoValue />
          ),
      },
      {
        id: 'resources',
        header: t('table.resources'),
        priority: 3,
        defaultHidden: true,
        sortValue: (item) => item.resources?.memoryUsedBytes ?? null,
        cell: (item) =>
          item.resources ? (
            <ResourceUsage
              cpu={item.resources.cpuUtilisation}
              memoryBytes={item.resources.memoryUsedBytes}
              className="text-2xs"
            />
          ) : (
            <NoValue />
          ),
      },
      {
        id: 'commit',
        header: t('table.commit'),
        priority: 3,
        // Useful, but the widest column here; off by default so the table fits a
        // laptop without scrolling sideways.
        defaultHidden: true,
        sortValue: (item) => item.lastCommit?.date ?? null,
        cell: (item) =>
          item.lastCommit ? (
            <span className="flex min-w-0 items-center gap-1.5 text-2xs">
              <Mono kind="sha" tone="subtle">
                {item.lastCommit.shortSha}
              </Mono>
              <span className="max-w-56 truncate text-muted">{item.lastCommit.subject}</span>
            </span>
          ) : (
            <NoValue />
          ),
      },
      {
        id: 'activity',
        header: t('table.activity'),
        align: 'right',
        priority: 2,
        sortValue: (item) => item.lastActivityAt,
        cell: (item) =>
          item.lastActivityAt ? (
            <span className="text-2xs tabular-nums text-muted" title={item.lastActivity ?? undefined}>
              {relativeTime(item.lastActivityAt)}
            </span>
          ) : (
            <NoValue />
          ),
      },
      {
        id: 'actions',
        header: '',
        srHeader: t('table.actions'),
        pinned: true,
        align: 'right',
        cell: (item) => (
          <div className="flex justify-end">
            <ProjectActionsMenu target={targetOf(item)} />
          </div>
        ),
      },
    ],
    [relativeTime, t],
  )

  /**
   * A bulk action is the same per-project action, run across a selection, with
   * one report at the end. Anything that stops or archives asks first and says
   * how many containers it will touch.
   */
  async function run(kind: BulkKind, selected: ProjectListItem[], clear: () => void): Promise<void> {
    setBusy(true)
    const failures: string[] = []
    let touched = 0
    for (const item of selected) {
      const target = targetOf(item)
      try {
        if (kind === 'archive') {
          await api.patchProject(item.slug, { archived: true })
          touched += 1
          continue
        }
        const { environments } = affectedBy(target, kind)
        if (environments.length === 0) continue
        const results = await Promise.allSettled(environments.map((name) => api.environmentAction(name, kind)))
        touched += results.filter((result) => result.status === 'fulfilled').length
        for (const [index, result] of results.entries()) {
          if (result.status !== 'rejected') continue
          const reason = result.reason as unknown
          const detail = reason instanceof ApiError ? reason.message : String(reason)
          failures.push(`${environments[index]}: ${detail}`)
        }
      } catch (error) {
        failures.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setBusy(false)
    setPending(null)
    clear()
    void queryClient.invalidateQueries()
    if (failures.length === 0) {
      toast.push({
        tone: 'ok',
        duration: 3000,
        title: ta(`done.${kind === 'archive' ? 'archive' : kind}`, { name: ta(`bulk.${kind}`), count: touched }),
      })
    } else {
      toast.push({
        tone: 'danger',
        title: ta('failed', { name: ta(`bulk.${kind}`) }),
        description: failures.join('\n'),
      })
    }
  }

  function bulkActions(selected: ProjectListItem[], clear: () => void): BulkAction[] {
    const startable = selected.filter((item) => item.environments.some((environment) => !environment.running))
    const stoppable = selected.filter((item) => item.environments.some((environment) => environment.running))
    return [
      {
        id: 'start',
        label: ta('bulk.start'),
        icon: <Play />,
        disabledReason: startable.length === 0 ? ta('bulk.nothingToStart') : undefined,
        onRun: () => void run('start', startable, clear),
      },
      {
        id: 'stop',
        label: ta('bulk.stop'),
        icon: <Square />,
        tone: 'danger',
        disabledReason: stoppable.length === 0 ? ta('bulk.nothingToStop') : undefined,
        onRun: () => setPending({ kind: 'stop', items: stoppable, clear }),
      },
      {
        id: 'restart',
        label: ta('bulk.restart'),
        icon: <RotateCw />,
        disabledReason: stoppable.length === 0 ? ta('bulk.nothingToStop') : undefined,
        onRun: () => setPending({ kind: 'restart', items: stoppable, clear }),
      },
      {
        id: 'archive',
        label: ta('bulk.archive'),
        icon: <Archive />,
        onRun: () => setPending({ kind: 'archive', items: selected.filter((item) => !item.archived), clear }),
      },
    ]
  }

  const containers =
    pending && pending.kind !== 'archive'
      ? pending.items.reduce(
          (sum, item) => sum + affectedBy(targetOf(item), pending.kind as LifecycleAction).containers,
          0,
        )
      : 0

  return (
    <>
      <DataTable
        rows={items}
        columns={columns}
        rowKey={(item) => item.slug}
        rowLabel={(item) => item.name}
        storageKey="projects"
        selectable
        bulkActions={bulkActions}
        arrangement={arrangement}
        caption={t('table.caption')}
        empty={empty}
      />

      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null)
          }}
          tone={pending.kind === 'stop' ? 'danger' : 'default'}
          title={
            pending.kind === 'archive'
              ? ta('bulk.archiveTitle', { count: pending.items.length })
              : pending.kind === 'stop'
                ? ta('bulk.stopTitle', { count: pending.items.length })
                : ta('bulk.restartTitle', { count: pending.items.length })
          }
          impact={
            pending.kind === 'archive'
              ? ta('bulk.archiveImpact')
              : pending.kind === 'stop'
                ? ta('bulk.stopImpact', { count: containers })
                : ta('bulk.restartImpact', { count: containers })
          }
          details={
            <ul className="list-inside list-disc text-xs text-ink">
              {pending.items.map((item) => (
                <li key={item.slug}>{item.name}</li>
              ))}
            </ul>
          }
          confirmLabel={
            pending.kind === 'archive'
              ? ta('bulk.archive')
              : pending.kind === 'stop'
                ? ta('bulk.stop')
                : ta('bulk.restart')
          }
          busy={busy}
          onConfirm={() => void run(pending.kind, pending.items, pending.clear)}
        />
      ) : null}
    </>
  )
}
