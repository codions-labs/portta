'use client'

import { GitBranch } from 'lucide-react'
import type { ProjectGit } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { changedCount, gitState } from '../../lib/git.ts'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { CodeChip, Mono } from '../copy.tsx'
import { KeyValue } from '../shell-bits.tsx'
import { Badge, StatusIndicator } from '../ui/badge.tsx'

function ExternalLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      className={cn('rounded-xs underline-offset-2 hover:text-ink hover:underline focus-ring', className)}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  )
}

/**
 * The one line that says what code is checked out: branch, HEAD, whether the
 * tree is clean, how far it drifted, and how old the answer is. `block` is
 * the same facts as rows, for a page that has the room.
 */
export function GitStatusLine({
  git: data,
  variant = 'line',
  refreshHint = true,
  className,
}: {
  git: ProjectGit | null
  variant?: 'line' | 'block'
  /** Show the host command when nothing was collected. */
  refreshHint?: boolean
  className?: string
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'git' })
  const { relativeTime } = useFormat()

  if (!data?.collected) {
    if (!refreshHint) return null
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle',
          variant === 'line' && 'px-3 py-1.5',
          className,
        )}
      >
        <GitBranch className="size-3.5" />
        <span>{t('empty')}.</span>
        {data ? <CodeChip>{data.refreshCommand}</CodeChip> : null}
      </div>
    )
  }
  const git = data.git
  if (!git) return null

  const state = gitState(git, data.stale)
  const changed = changedCount(git)
  const branch = git.detached ? (
    <Badge tone="warn">{t('detachedHead')}</Badge>
  ) : data.links.branch ? (
    <ExternalLink href={data.links.branch} className="font-medium text-ink">
      {git.branch}
    </ExternalLink>
  ) : (
    <span className="font-medium text-ink">{git.branch}</span>
  )
  const head = data.links.commit ? (
    <ExternalLink href={data.links.commit} className="font-mono">
      {git.head.shortSha}
    </ExternalLink>
  ) : (
    <Mono kind="sha">{git.head.shortSha}</Mono>
  )
  const tree =
    changed > 0 ? (
      <StatusIndicator tone="warn">{t('uncommittedChanges', { count: changed })}</StatusIndicator>
    ) : (
      <StatusIndicator tone="ok">{t('clean')}</StatusIndicator>
    )
  const drift = (
    <>
      {git.ahead > 0 ? <Badge tone="outline">{t('ahead', { count: git.ahead })}</Badge> : null}
      {git.behind > 0 ? <Badge tone="outline">{t('behind', { count: git.behind })}</Badge> : null}
    </>
  )
  const age = (
    <span title={state === 'stale' ? t('staleHint', { seconds: data.staleAfterSeconds }) : undefined}>
      {state === 'stale' ? (
        <Badge tone="warn">{t('collectedAgo', { time: relativeTime(data.collectedAt) })}</Badge>
      ) : (
        t('collectedAgo', { time: relativeTime(data.collectedAt) })
      )}
    </span>
  )

  if (variant === 'line') {
    return (
      <div
        className={cn('flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs', className)}
        data-git-state={state}
      >
        <span className="flex items-center gap-1.5 text-muted">
          <GitBranch className="size-3.5" />
          {branch}
        </span>
        {git.head.shortSha ? (
          <span className="text-muted">
            {head}
            {git.head.subject ? <span className="ml-2 text-subtle">{git.head.subject}</span> : null}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          {tree}
          {drift}
        </span>
        <span className="ml-auto flex items-center gap-2 text-subtle">
          {data.remote ? <ExternalLink href={data.remote.repoUrl}>{data.remote.slug}</ExternalLink> : null}
          {age}
        </span>
      </div>
    )
  }

  return (
    <dl className={cn('divide-y divide-line-subtle', className)} data-git-state={state}>
      <KeyValue label={t('branch')}>
        <span className="flex flex-wrap items-center gap-1.5">
          {branch}
          {tree}
          {drift}
        </span>
      </KeyValue>
      <KeyValue label="HEAD">
        {head}
        {git.head.subject ? <span className="ml-2 text-muted">{git.head.subject}</span> : null}
      </KeyValue>
      {git.head.author ? <KeyValue label={t('author')}>{git.head.author}</KeyValue> : null}
      <KeyValue label={t('workingTree')}>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={git.staged > 0 ? 'warn' : 'outline'}>{t('staged', { count: git.staged })}</Badge>
          <Badge tone={git.unstaged > 0 ? 'warn' : 'outline'}>{t('unstaged', { count: git.unstaged })}</Badge>
          <Badge tone={git.untracked > 0 ? 'warn' : 'outline'}>{t('untracked', { count: git.untracked })}</Badge>
          <Badge tone={git.unmerged > 0 ? 'danger' : 'outline'}>{t('unmerged', { count: git.unmerged })}</Badge>
        </span>
      </KeyValue>
      <KeyValue label={t('upstream')}>
        {git.upstream ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Mono kind="branch" tone="ink" className="text-xs">
              {git.upstream}
            </Mono>
            <Badge tone={git.ahead > 0 ? 'accent' : 'outline'}>{t('ahead', { count: git.ahead })}</Badge>
            <Badge tone={git.behind > 0 ? 'warn' : 'outline'}>{t('behind', { count: git.behind })}</Badge>
          </span>
        ) : (
          <span className="text-subtle">{t('noUpstream')}</span>
        )}
      </KeyValue>
      {data.remote ? (
        <KeyValue label={t('remote')}>
          <ExternalLink href={data.remote.repoUrl}>{data.remote.slug}</ExternalLink>
          <span className="ml-2 text-xs text-subtle">{data.remote.host}</span>
        </KeyValue>
      ) : null}
      {data.workingDir ? (
        <KeyValue label={t('scannedDirectory')}>
          <Mono kind="path" tone="ink" value={data.workingDir} />
        </KeyValue>
      ) : null}
      <KeyValue label={t('collected')}>{age}</KeyValue>
      {refreshHint ? (
        <KeyValue label={t('refreshOnHost')}>
          <CodeChip>{data.refreshCommand}</CodeChip>
        </KeyValue>
      ) : null}
    </dl>
  )
}
