'use client'

import { ExternalLink, GitBranch } from 'lucide-react'
import type { Repository } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { Mono } from '../copy.tsx'
import { Badge, StatusIndicator } from '../ui/badge.tsx'

export function repositoryHref(projectSlug: string, repositoryId: string, tab?: string): string {
  return `/projects/${encodeURIComponent(projectSlug)}/repositories/${encodeURIComponent(repositoryId)}${tab ? `/${tab}` : ''}`
}

/** The compact Git facts of a repository, from the summary a list carries. */
export function RepositoryGitLine({ git, className }: { git: Repository['git']; className?: string }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'git' })
  const { relativeTime } = useFormat()
  if (!git) return <span className={cn('text-xs text-subtle', className)}>{t('notCollected')}</span>
  return (
    <span
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', className)}
      data-git-state={git.stale ? 'stale' : git.dirty ? 'dirty' : 'clean'}
    >
      <span className="flex items-center gap-1 text-muted">
        <GitBranch className="size-3.5" />
        {git.detached ? (
          <Badge tone="warn">{t('detached')}</Badge>
        ) : (
          <span className="font-medium text-ink">{git.branch}</span>
        )}
      </span>
      <Mono kind="sha">{git.head.shortSha}</Mono>
      {git.head.subject ? (
        <span className="truncate text-subtle" title={git.head.subject}>
          {git.head.subject}
        </span>
      ) : null}
      {git.changed > 0 ? (
        <StatusIndicator tone="warn">{t('changed', { count: git.changed })}</StatusIndicator>
      ) : (
        <StatusIndicator tone="ok">{t('clean')}</StatusIndicator>
      )}
      {git.ahead > 0 ? <Badge tone="outline">{t('ahead', { count: git.ahead })}</Badge> : null}
      {git.behind > 0 ? <Badge tone="outline">{t('behind', { count: git.behind })}</Badge> : null}
      <span className={cn('text-subtle', git.stale && 'text-warn')} title={git.stale ? t('stale') : undefined}>
        {t('collected', { time: relativeTime(git.collectedAt) })}
      </span>
    </span>
  )
}

/**
 * One repository of a Project. `row` is the line a list shows; `card` adds
 * the path and the environments, for the cockpit.
 */
export function RepositoryRow({
  repository,
  projectSlug,
  density = 'row',
  actions,
  className,
}: {
  repository: Repository
  projectSlug: string
  density?: 'row' | 'card'
  actions?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation('repositories')
  const href = repositoryHref(projectSlug, repository.id)
  const path = repository.scanPath ?? repository.localPath
  return (
    <div
      role="group"
      aria-label={t('rowLabel', { name: repository.name })}
      className={cn(
        'grid gap-x-3 gap-y-1 border-b border-line-subtle px-3 py-2 text-sm transition-colors duration-100 last:border-b-0 hover:bg-fill lg:grid-cols-[minmax(10rem,0.5fr)_1fr_auto] lg:items-center',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <a className="rounded-xs font-medium text-ink underline-offset-2 hover:underline focus-ring" href={href}>
          {repository.name}
        </a>
        {repository.role ? <Badge tone="outline">{repository.role}</Badge> : null}
        {repository.github ? (
          <a
            className="inline-flex items-center gap-1 rounded-xs text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring"
            href={repository.github.htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {repository.github.slug}
            <ExternalLink className="size-3" />
          </a>
        ) : repository.provider !== 'local' ? (
          <Badge tone="neutral">{repository.provider}</Badge>
        ) : (
          <Badge tone="neutral">{t('provider.local')}</Badge>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <RepositoryGitLine git={repository.git} />
        {density === 'card' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            {path ? <Mono kind="path" tone="subtle" value={path} /> : <span>{t('noPath')}</span>}
            {repository.environments.map((environment) => (
              <a
                key={environment}
                className="rounded-xs text-accent underline-offset-2 hover:underline focus-ring"
                href={`/environments/${encodeURIComponent(environment)}`}
              >
                {environment}
              </a>
            ))}
            {repository.instructionCount > 0 ? (
              <a
                className="underline-offset-2 hover:underline"
                href={repositoryHref(projectSlug, repository.id, 'instructions')}
              >
                {t('instructionCount', { count: repository.instructionCount })}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className="justify-self-end">{actions}</div> : null}
    </div>
  )
}
