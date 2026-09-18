'use client'

// The side of an issue: its properties, and the environments Portta knows are
// running for it.
//
// Labels and assignees are changed one at a time, as an addition or a removal,
// because that is what both providers accept — and because two people editing
// the same issue then merge instead of clobbering each other.

import { Boxes, GitBranch } from 'lucide-react'
import Link from 'next/link'
import type { Issue, IssueEnvironmentLink, IssueVocabulary, IssueWorktreeLink } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Empty, Eyebrow, NoValue } from '@/components/shell-bits'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { PopoverClose } from '@/components/ui/popover'
import type { PatchIssueInput } from '@/lib/api'
import { useFormat } from '@/lib/use-format'
import { taskflowPaths } from '@/modules/taskflow/lib/navigation.ts'
import { IssueAssignees, IssueLabels, IssueStateBadge } from './issue-badges.tsx'
import { PropertyChoice, PropertyMenu, PropertyRow } from './property-row.tsx'
import { useProviderName } from './provider.ts'

export function IssueProperties({
  issue,
  projectSlug,
  vocabulary,
  readOnly,
  onPatch,
}: {
  issue: Issue
  projectSlug: string
  vocabulary?: IssueVocabulary
  readOnly: boolean
  onPatch: (body: PatchIssueInput) => void
}) {
  const { t } = useTranslation('issues')
  const { relativeTime } = useFormat()
  const providerName = useProviderName()
  const labels = vocabulary?.labels ?? []
  const assignees = vocabulary?.assignees ?? []
  const milestones = vocabulary?.milestones ?? []
  const chosenLabels = new Set(issue.labels.map((label) => label.name))
  const chosenAssignees = new Set(issue.assignees.map((user) => user.login))

  return (
    <aside className="space-y-5 lg:sticky lg:top-4">
      <dl className="space-y-0.5">
        <PropertyRow label={t('state.label')}>
          <IssueStateBadge state={issue.state} reason={issue.stateReason} />
        </PropertyRow>

        <PropertyMenu
          label={t('detail.labels')}
          empty={issue.labels.length === 0}
          value={issue.labels.length > 0 ? <IssueLabels labels={issue.labels} max={4} /> : t('detail.addLabels')}
          disabled={readOnly || labels.length === 0}
        >
          {labels.map((label) => (
            <PopoverClose key={label.name} asChild>
              <PropertyChoice
                selected={chosenLabels.has(label.name)}
                onSelect={() =>
                  onPatch(chosenLabels.has(label.name) ? { removeLabels: [label.name] } : { addLabels: [label.name] })
                }
              >
                <IssueLabels labels={[label]} max={1} />
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyMenu
          label={t('detail.assignees')}
          empty={issue.assignees.length === 0}
          value={
            issue.assignees.length > 0 ? (
              <IssueAssignees assignees={issue.assignees} max={4} />
            ) : (
              t('detail.addAssignees')
            )
          }
          disabled={readOnly || assignees.length === 0}
        >
          {assignees.map((user) => (
            <PopoverClose key={user.login} asChild>
              <PropertyChoice
                selected={chosenAssignees.has(user.login)}
                onSelect={() =>
                  onPatch(
                    chosenAssignees.has(user.login)
                      ? { removeAssignees: [user.login] }
                      : { addAssignees: [user.login] },
                  )
                }
              >
                {user.login}
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyMenu
          label={t('detail.milestone')}
          empty={!issue.milestone}
          value={issue.milestone?.title ?? t('detail.noMilestone')}
          disabled={readOnly || milestones.length === 0}
        >
          {/* An empty string clears it, which is how `gh` spells it too. */}
          <PopoverClose asChild>
            <PropertyChoice selected={!issue.milestone} onSelect={() => onPatch({ milestone: '' })}>
              {t('detail.noMilestone')}
            </PropertyChoice>
          </PopoverClose>
          {milestones.map((entry) => (
            <PopoverClose key={entry.title} asChild>
              <PropertyChoice
                selected={issue.milestone?.title === entry.title}
                onSelect={() => onPatch({ milestone: entry.title })}
              >
                {entry.title}
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyRow label={t('detail.author')} empty={!issue.author}>
          {issue.author ? <span className="truncate">{issue.author.login}</span> : <NoValue />}
        </PropertyRow>
        <PropertyRow label={t('detail.created')}>
          <span className="text-xs tabular-nums">{relativeTime(issue.createdAt)}</span>
        </PropertyRow>
        <PropertyRow label={t('detail.updated')}>
          <span className="text-xs tabular-nums">{relativeTime(issue.updatedAt)}</span>
        </PropertyRow>
      </dl>

      <IssueWorktrees issue={issue} projectSlug={projectSlug} />
      <IssueEnvironments issue={issue} providerName={providerName(issue.provider)} />
    </aside>
  )
}

function IssueWorktrees({ issue, projectSlug }: { issue: Issue; projectSlug: string }) {
  const { t } = useTranslation('issues')
  return (
    <section className="space-y-1.5">
      <Eyebrow>{t('detail.worktrees')}</Eyebrow>
      {issue.worktrees.length === 0 ? (
        <Empty compact icon={GitBranch} title={t('detail.noWorktrees')} />
      ) : (
        <ul className="overflow-hidden rounded-md border border-line">
          {issue.worktrees.map((link) => (
            <WorktreeLink key={`${link.path}:${link.branch}`} link={link} projectSlug={projectSlug} />
          ))}
        </ul>
      )}
    </section>
  )
}

function WorktreeLink({ link, projectSlug }: { link: IssueWorktreeLink; projectSlug: string }) {
  const { t } = useTranslation('issues')
  const paths = taskflowPaths(projectSlug)
  return (
    <li className="border-b border-line-subtle px-2.5 py-1.5 text-sm last:border-b-0 hover:bg-fill">
      {link.branch ? (
        <Link
          className="block truncate rounded-xs font-medium underline-offset-2 hover:underline focus-ring"
          href={paths.worktree(link.branch)}
        >
          {link.branch}
        </Link>
      ) : (
        <span className="text-subtle">{t('detail.noWorktrees')}</span>
      )}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
        {link.runId ? (
          <Link
            className="rounded-xs text-accent underline-offset-2 hover:underline focus-ring"
            href={paths.run(link.runId)}
          >
            {t('detail.run')}
            {link.runStatus ? ` · ${link.runStatus}` : ''}
          </Link>
        ) : null}
        {link.pullRequestUrl ? (
          <a
            className="rounded-xs text-accent underline-offset-2 hover:underline focus-ring"
            href={link.pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('detail.pr')}
            {link.pullRequestState ? ` · ${link.pullRequestState}` : ''}
          </a>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The one thing on this page that the provider does not know.
 *
 * GitHub can say who is assigned; only Portta can say that `shop-113` is up on
 * this host because of it. That is why it sits here rather than at the bottom
 * of the page, and why each row says *why* Portta thinks the two are related.
 */
function IssueEnvironments({ issue, providerName }: { issue: Issue; providerName: string }) {
  const { t } = useTranslation('issues')
  return (
    <section className="space-y-1.5">
      <Eyebrow>{t('detail.environments')}</Eyebrow>
      {issue.environments.length === 0 ? (
        <Empty compact icon={Boxes} title={t('detail.noEnvironments')} />
      ) : (
        <>
          <ul className="overflow-hidden rounded-md border border-line">
            {issue.environments.map((link) => (
              <EnvironmentLink key={link.environment} link={link} />
            ))}
          </ul>
          <p className="text-2xs text-subtle">{t('detail.environmentsHint', { provider: providerName })}</p>
        </>
      )}
      {issue.activeSessionCount > 0 ? (
        <Badge tone="agent" dot>
          {t('detail.sessions', { count: issue.activeSessionCount })}
        </Badge>
      ) : null}
    </section>
  )
}

const SOURCE_LABEL = {
  manual: 'detail.source.manual',
  label: 'detail.source.label',
  branch: 'detail.source.branch',
  namespace: 'detail.source.namespace',
} as const

function EnvironmentLink({ link }: { link: IssueEnvironmentLink }) {
  const { t } = useTranslation('issues')
  return (
    <li className="border-b border-line-subtle px-2.5 py-1.5 text-sm last:border-b-0 hover:bg-fill">
      <a
        className="block truncate rounded-xs font-medium underline-offset-2 hover:underline focus-ring"
        href={link.panelUrl}
      >
        {link.environment}
      </a>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {link.running ? (
          <StatusIndicator tone={link.unhealthyCount > 0 ? 'danger' : 'ok'}>
            {t('detail.environmentRunning', { running: link.runningCount, total: link.serviceCount })}
          </StatusIndicator>
        ) : (
          <StatusIndicator tone="neutral">{t('detail.environmentStopped')}</StatusIndicator>
        )}
        {link.unhealthyCount > 0 ? (
          <Badge tone="danger">{t('detail.unhealthy', { count: link.unhealthyCount })}</Badge>
        ) : null}
        {link.branch ? (
          <Mono kind="branch" className="text-2xs">
            {link.branch}
          </Mono>
        ) : null}
      </div>
      {/* Why Portta thinks this environment is this issue's: the link is a
          derivation, and a derivation nobody can check is a guess. */}
      <p className="mt-0.5 text-2xs text-subtle" title={link.reason}>
        {t(SOURCE_LABEL[link.source])} · {link.reason}
      </p>
    </li>
  )
}
