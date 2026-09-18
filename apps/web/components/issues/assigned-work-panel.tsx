'use client'

// What is assigned to whoever is reading, across every provider a Project is
// linked to.
//
// The distinction this panel exists to keep is `available`: an empty list from
// a provider that answered means there is nothing to do, and an empty list from
// a provider nobody could reach means nothing is known. Showing a reassuring
// zero for the second is the one thing a dashboard must not do, so the two
// states are drawn differently and the reason is named.

import { CircleDot, HelpCircle } from 'lucide-react'
import Link from 'next/link'
import type { DevelopmentOverview, IssueSummary } from 'portta-contracts'
import { issueRefLabel } from 'portta-core/browser'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Callout, Empty } from '@/components/shell-bits'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { useFormat } from '@/lib/use-format'
import { IssueLabels } from './issue-badges.tsx'

export function AssignedWorkPanel({ work }: { work: DevelopmentOverview['work'] }) {
  const { t } = useTranslation('issues')
  return (
    <Card>
      <CardHeader
        title={t('overview.title')}
        icon={<CircleDot />}
        meta={
          work.available ? (
            <span className="text-xs font-normal text-subtle tabular-nums">{work.assigned.length}</span>
          ) : undefined
        }
      />
      {!work.available ? (
        <CardBody>
          <Callout tone="neutral" icon={<HelpCircle />} title={t('overview.unknown')}>
            {work.unavailableReason ?? t('overview.unknownHint')}
          </Callout>
        </CardBody>
      ) : work.assigned.length === 0 ? (
        <Empty compact tone="ok" title={t('overview.empty')} />
      ) : (
        work.assigned.map((issue) => <AssignedRow key={issue.ref} issue={issue} />)
      )}
    </Card>
  )
}

function AssignedRow({ issue }: { issue: IssueSummary }) {
  const { relativeTime } = useFormat()
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-2 border-b border-line-subtle px-3 text-sm last:border-b-0 hover:bg-fill">
      {/* The ref names the repository as well as the number, which is the only
          thing that tells two `#113`s apart on a dashboard spanning projects. */}
      <Mono kind="id" tone="subtle" className="shrink-0 text-xs">
        {issueRefLabel(issue.ref)}
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
