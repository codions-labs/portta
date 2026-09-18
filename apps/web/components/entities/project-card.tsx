'use client'

import { Bot, Boxes, FolderGit2, GitCommitHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectListItem } from '../../lib/projects.ts'
import { projectState, projectStateTone } from '../../lib/projects.ts'
import { narrowTone } from '../../lib/tone.ts'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { StatusIndicator } from '../ui/badge.tsx'
import { Card } from '../ui/card.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { ProjectActionsMenu, ProjectPrimaryAction } from './project-actions.tsx'
import { ResourceUsage } from './resource-usage.tsx'

/** The project's operational state, said once, in the tone that state deserves. */
export function ProjectStateBadge({ item, className }: { item: ProjectListItem; className?: string }) {
  const { t } = useTranslation('projects', { keyPrefix: 'state' })
  const state = projectState(item)
  return (
    <Tooltip label={t(`${state}Hint` as 'runningHint')}>
      <span tabIndex={0} className={cn('inline-flex rounded-xs focus-ring', className)}>
        <StatusIndicator tone={narrowTone(projectStateTone(state))} pulse={false}>
          {t(state)}
        </StatusIndicator>
      </span>
    </Tooltip>
  )
}

/**
 * The counts that say what is happening in a project, as one line rather than
 * six scattered badges. Anything that is zero is left out; a project with no
 * agent on it should not carry a badge saying so.
 */
export function ProjectCounts({ item, className }: { item: ProjectListItem; className?: string }) {
  const { t } = useTranslation('projects')
  const facts: Array<{ id: string; icon: typeof Boxes; label: string; text: string; tone?: 'danger' | 'agent' }> = []

  facts.push({
    id: 'repositories',
    icon: FolderGit2,
    label: t(item.repositoryCount === 1 ? 'repository' : 'repositories', { count: item.repositoryCount }),
    text: String(item.repositoryCount),
  })
  facts.push({
    id: 'environments',
    icon: Boxes,
    label: t('running', { running: item.runningEnvironments, total: item.environmentCount }),
    text: `${item.runningEnvironments}/${item.environmentCount}`,
  })
  if (item.activeSessions) {
    facts.push({
      id: 'sessions',
      icon: Bot,
      label: t('pulse.sessions', { count: item.activeSessions }),
      text: String(item.activeSessions),
      tone: 'agent',
    })
  }

  return (
    <span className={cn('inline-flex items-center gap-2.5 text-xs tabular-nums text-muted', className)}>
      {facts.map((fact) => {
        const Icon = fact.icon
        return (
          <Tooltip key={fact.id} label={fact.label}>
            <span
              role="group"
              tabIndex={0}
              // The tooltip only exists while it is open; the number and its
              // icon need a name at all times, for a reader and for a test.
              aria-label={fact.label}
              className={cn(
                'inline-flex items-center gap-1 rounded-xs focus-ring',
                fact.tone === 'danger' ? 'text-danger' : fact.tone === 'agent' ? 'text-agent' : undefined,
              )}
            >
              <Icon className="size-3" aria-hidden />
              {fact.text}
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}

/**
 * A project as a card.
 *
 * It was a passive tile: a name, a description and a row of badges. It now
 * carries the one action its state allows and a menu with the rest, so a
 * project can be started, stopped or opened without ever leaving the list —
 * which was the whole complaint about this page.
 */
export function ProjectCard({ item }: { item: ProjectListItem }) {
  const { relativeTime } = useFormat()
  const target = { slug: item.slug, name: item.name, archived: item.archived, environments: item.environments }

  return (
    <Card className="group flex min-w-0 flex-col">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <a
              className="min-w-0 truncate rounded-xs text-sm font-medium text-ink underline-offset-2 hover:underline focus-ring"
              href={`/projects/${encodeURIComponent(item.slug)}`}
            >
              {item.name}
            </a>
            <ProjectStateBadge item={item} />
          </div>
          {item.description ? <p className="mt-0.5 line-clamp-2 text-xs text-subtle">{item.description}</p> : null}
        </div>
        <div className="row-actions flex shrink-0 items-center">
          <ProjectPrimaryAction target={target} />
          <ProjectActionsMenu target={target} />
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <ProjectCounts item={item} />
        {item.resources ? (
          <ResourceUsage
            cpu={item.resources.cpuUtilisation}
            memoryBytes={item.resources.memoryUsedBytes}
            className="text-2xs"
          />
        ) : null}
      </div>

      {item.lastCommit || item.lastActivity ? (
        <div className="mt-auto flex min-w-0 items-center gap-1.5 border-t border-line px-3 py-1.5 text-2xs text-subtle">
          {item.lastCommit ? (
            <>
              <GitCommitHorizontal className="size-3 shrink-0" aria-hidden />
              <span className="font-mono">{item.lastCommit.shortSha}</span>
              <span className="min-w-0 truncate">{item.lastCommit.subject}</span>
              <span className="ml-auto shrink-0">{relativeTime(item.lastCommit.date)}</span>
            </>
          ) : (
            <>
              <span className="min-w-0 truncate">{item.lastActivity}</span>
              <span className="ml-auto shrink-0">{relativeTime(item.lastActivityAt)}</span>
            </>
          )}
        </div>
      ) : null}
    </Card>
  )
}

/**
 * A project as one line, for a dashboard panel. The Projects page uses the
 * table instead; this is what fits in a third of a cockpit.
 */
export function ProjectRow({ item, className }: { item: ProjectListItem; className?: string }) {
  return (
    <div
      role="group"
      aria-label={item.name}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 border-b border-line-subtle px-3 text-sm transition-colors duration-100 last:border-b-0 hover:bg-fill',
        className,
      )}
    >
      <a
        className="min-w-24 flex-1 truncate rounded-xs font-medium text-ink underline-offset-2 hover:underline focus-ring"
        href={`/projects/${encodeURIComponent(item.slug)}`}
        title={item.name}
      >
        {item.name}
      </a>
      <ProjectCounts item={item} className="hidden w-28 shrink-0 justify-start sm:inline-flex" />
      <ProjectStateBadge item={item} className="w-24 shrink-0 justify-start" />
    </div>
  )
}
