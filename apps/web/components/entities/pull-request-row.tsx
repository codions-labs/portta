'use client'

import type { ForgePullRequest } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '../copy.tsx'
import { Badge, StatusIndicator } from '../ui/badge.tsx'

/** One open pull request with its review decision and checks, as a line. */
export function PullRequestRow({ pull, showBranch = false }: { pull: ForgePullRequest; showBranch?: boolean }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'pulls' })
  const review =
    pull.reviewDecision === 'APPROVED'
      ? { tone: 'ok' as const, label: t('approved') }
      : pull.reviewDecision === 'CHANGES_REQUESTED'
        ? { tone: 'danger' as const, label: t('changesRequested') }
        : pull.reviewDecision === 'REVIEW_REQUIRED'
          ? { tone: 'warn' as const, label: t('reviewRequested') }
          : null
  const title = `#${pull.number} ${pull.title}`
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 px-3 py-1.5 text-xs">
      {pull.url ? (
        <a
          className="rounded-xs text-ink underline-offset-2 hover:underline focus-ring"
          href={pull.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {title}
        </a>
      ) : (
        <span>{title}</span>
      )}
      {pull.draft ? <Badge>{t('draft')}</Badge> : null}
      {review ? <Badge tone={review.tone}>{review.label}</Badge> : null}
      {pull.checks === 'failing' ? (
        <StatusIndicator tone="danger">{t('checksFailing')}</StatusIndicator>
      ) : pull.checks === 'pending' ? (
        <StatusIndicator tone="warn" pulse>
          {t('checksPending')}
        </StatusIndicator>
      ) : pull.checks === 'passing' ? (
        <StatusIndicator tone="ok">{t('checksPassing')}</StatusIndicator>
      ) : null}
      {showBranch && pull.headRefName ? (
        <Mono kind="branch" tone="subtle" className="text-2xs">
          {pull.headRefName}
        </Mono>
      ) : null}
    </div>
  )
}
