'use client'

// The open issues of one Project, as a few lines on its overview.
//
// A handful of rows rather than the tab's table: the overview answers "what is
// going on here", and the answer to that is the newest open work plus a way in,
// not a sortable list of ninety. The caller only mounts this where a provider
// is resolved, so the card never spends a provider call to be told there is
// nothing to read.

import Link from 'next/link'
import type { IssueSummary, Project } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Empty, SkeletonRows } from '@/components/shell-bits'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useIssues } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { IssueLabels, IssueStateBadge } from './issue-badges.tsx'
import { IssueTrouble } from './issue-trouble.tsx'

const SHOWN = 5

export function ProjectIssuesCard({ project }: { project: Project }) {
  const { t } = useTranslation('issues')
  const issues = useIssues(project.slug, { state: 'open' })
  const rows = (issues.data ?? []).slice(0, SHOWN)
  const href = `/projects/${encodeURIComponent(project.slug)}/issues`

  return (
    <Card>
      <CardHeader
        title={t('projectCard.title')}
        meta={
          issues.data ? (
            <span className="text-xs font-normal text-subtle tabular-nums">{issues.data.length}</span>
          ) : undefined
        }
        actions={
          <Link className="rounded-xs text-xs text-accent hover:underline focus-ring" href={href}>
            {t('projectCard.all')}
          </Link>
        }
      />
      {issues.error ? (
        <CardBody>
          <IssueTrouble error={issues.error} work={project.work} />
        </CardBody>
      ) : issues.isPending ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <Empty compact title={t('projectCard.empty')} />
      ) : (
        rows.map((issue) => <IssueLine key={issue.ref} issue={issue} />)
      )}
    </Card>
  )
}

function IssueLine({ issue }: { issue: IssueSummary }) {
  const { relativeTime } = useFormat()
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-2 border-b border-line-subtle px-3 text-sm last:border-b-0 hover:bg-fill">
      <IssueStateBadge state={issue.state} reason={issue.stateReason} iconOnly />
      <Mono kind="id" tone="subtle" className="shrink-0 text-xs">
        {issue.key}
      </Mono>
      <Link
        className="min-w-0 flex-1 truncate rounded-xs underline-offset-2 hover:underline focus-ring"
        href={issue.panelUrl}
        title={issue.title}
      >
        {issue.title}
      </Link>
      {issue.labels.length > 0 ? (
        <IssueLabels labels={issue.labels} max={1} className="hidden shrink-0 sm:flex" />
      ) : null}
      <span className="shrink-0 text-2xs text-subtle tabular-nums">{relativeTime(issue.updatedAt)}</span>
    </div>
  )
}
