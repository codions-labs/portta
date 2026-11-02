'use client'

// Where this environment's code stands, so what is running can be told apart from what is on
// disk: the branch, the last commit, what is not committed and what is not pushed.
//
// Read on the host from the environment's folder and never from GitHub, which the card says.

import type { Environment, GitState } from 'portta-contracts'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Callout } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { useMetricsCurrent } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

const STATUS_TONE = { M: 'text-warn', A: 'text-ok', D: 'text-danger', U: 'text-info' } as const

type Verdict = 'changed' | 'unpushed' | 'behind' | 'noUpstream' | 'clean'

export function gitVerdict(git: GitState): Verdict {
  if (git.changed + git.untracked > 0) return 'changed'
  if ((git.ahead ?? 0) > 0) return 'unpushed'
  if ((git.behind ?? 0) > 0) return 'behind'
  if (git.upstream === null) return 'noUpstream'
  return 'clean'
}

const VERDICT_TONE = { changed: 'warn', unpushed: 'info', behind: 'info', noUpstream: 'neutral', clean: 'ok' } as const

/** The running containers started before the last commit was made: what is up may not have it. */
export function startedBeforeCommit(environment: Pick<Environment, 'services'>, git: GitState, now: number): boolean {
  if (!git.head) return false
  const committed = git.head.at
  return environment.services.some(
    (container) =>
      container.state === 'running' && container.uptimeSeconds !== null && now - container.uptimeSeconds < committed,
  )
}

export function EnvironmentGit({ environment }: { environment: Environment }) {
  const { t } = useTranslation('environments', { keyPrefix: 'git' })
  const { relativeTime } = useFormat()
  const metrics = useMetricsCurrent()
  const git = metrics.data?.projects.find((project) => project.composeProject === environment.name)?.git
  if (!git) return null

  const dirty = git.changed + git.untracked
  const verdict = gitVerdict(git)
  const shown = git.files.length
  const stale = startedBeforeCommit(environment, git, Math.floor(Date.now() / 1000))

  const rows: Array<{ key: string; label: string; value: ReactNode }> = [
    {
      key: 'branch',
      label: t('branch'),
      value: git.branch ? (
        <Mono kind="text" tone="ink">
          {git.branch}
        </Mono>
      ) : (
        t('detached')
      ),
    },
    {
      key: 'commit',
      label: t('lastCommit'),
      value: git.head ? (
        <span>
          <Mono kind="text" tone="ink">
            {git.head.sha}
          </Mono>{' '}
          {git.head.subject}
          <span className="block text-xs text-subtle">
            {git.head.author} · {relativeTime(git.head.at)}
          </span>
        </span>
      ) : (
        <span className="text-subtle">{t('noCommit')}</span>
      ),
    },
    { key: 'uncommitted', label: t('uncommitted'), value: dirty === 0 ? t('none') : t('files', { count: dirty }) },
    {
      key: 'unpushed',
      label: t('unpushed'),
      value:
        git.upstream === null
          ? t('noUpstreamValue')
          : (git.ahead ?? 0) > 0
            ? t('commitsTo', { count: git.ahead ?? 0, upstream: git.upstream })
            : t('allPushed', { upstream: git.upstream }),
    },
    ...((git.behind ?? 0) > 0
      ? [{ key: 'behind', label: t('behind'), value: t('commits', { count: git.behind ?? 0 }) }]
      : []),
    ...(git.lastChangeAt !== null
      ? [{ key: 'changed', label: t('lastChange'), value: relativeTime(git.lastChangeAt) }]
      : []),
    {
      key: 'folder',
      label: t('folder'),
      value: (
        <Mono kind="path" className="text-xs break-all whitespace-normal">
          {git.path}
        </Mono>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader title={t('title')} actions={<Badge tone={VERDICT_TONE[verdict]}>{t(`verdict.${verdict}`)}</Badge>} />
      <div className="space-y-3.5 px-5 py-4">
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.key} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd className="min-w-0 text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>

        {stale ? <Callout tone="warn">{t('startedBefore')}</Callout> : null}

        {shown > 0 ? (
          <ul className="space-y-0.5" aria-label={t('filesAria')}>
            {git.files.map((file) => (
              <li key={file.path} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={file.path}>
                  {file.path}
                </span>
                <span className={cn('shrink-0 text-xs font-semibold', STATUS_TONE[file.status])}>
                  {t(`status.${file.status}`)}
                </span>
              </li>
            ))}
            {dirty > shown ? <li className="text-xs text-subtle">{t('moreFiles', { count: dirty - shown })}</li> : null}
          </ul>
        ) : null}

        <p className="text-xs text-subtle">{t('readOn', { time: relativeTime(git.collectedAt) })}</p>
      </div>
    </Card>
  )
}
