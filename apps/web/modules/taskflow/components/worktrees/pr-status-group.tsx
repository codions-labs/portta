'use client'

import { ArrowUpRight, MessageSquare } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PrEntry } from '../../lib/types.ts'
import {
  ciStatusDotClass,
  ciStatusTextClass,
  cn,
  isDraftPr,
  prLabel,
  prStateTextClass,
  prStatusShellClass,
} from '../../lib/utils.ts'

interface PrStatusGroupProps {
  pr: PrEntry
  onCiClick: (pr: PrEntry) => void
  onReviewsClick: (pr: PrEntry) => void
}

const segmentClass =
  'relative flex cursor-pointer items-center gap-1.5 bg-transparent px-2.5 py-1.5 transition-colors duration-100 hover:bg-fill active:bg-selection focus-ring-inset'

export function PrStatusGroup({ pr, onCiClick, onReviewsClick }: PrStatusGroupProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'pr' })
  const label = prLabel(pr)
  const draft = isDraftPr(pr)
  const dividedSegmentClass = cn(segmentClass, 'border-l border-line')

  function stopAndRun(event: MouseEvent<HTMLButtonElement>, action: () => void): void {
    event.stopPropagation()
    action()
  }

  return (
    <div
      className={cn(
        'inline-flex min-w-0 shrink-0 items-stretch overflow-hidden rounded-full border text-2xs font-medium leading-none',
        prStatusShellClass(pr),
      )}
    >
      <a
        href={pr.url}
        target="_blank"
        rel="noopener"
        className={cn(segmentClass, 'min-w-0 no-underline', prStateTextClass(pr))}
        title={draft ? t('openDraft') : t('open')}
      >
        <span className="truncate">{label}</span>
        {draft ? <span className="text-[9px] uppercase tracking-[0.08em]">{t('draft')}</span> : null}
        <ArrowUpRight aria-hidden className="size-3" />
      </a>
      {pr.ciChecks.length > 0 ? (
        <button
          type="button"
          className={cn(dividedSegmentClass, ciStatusTextClass(pr.ciStatus))}
          onClick={(event) => stopAndRun(event, () => onCiClick(pr))}
          title={t('viewChecks')}
          aria-label={t('viewChecksFor', { pr: label })}
        >
          <span className={cn('inline-block size-1.5 rounded-full', ciStatusDotClass(pr.ciStatus))} />
          <span className="text-[9px] uppercase tracking-[0.08em]">{t('ci')}</span>
        </button>
      ) : null}
      {pr.comments.length > 0 ? (
        <button
          type="button"
          className={cn(dividedSegmentClass, 'text-accent')}
          onClick={(event) => stopAndRun(event, () => onReviewsClick(pr))}
          title={t('reviewComments')}
          aria-label={t('reviewCommentsFor', { count: pr.comments.length, pr: label })}
        >
          <MessageSquare aria-hidden className="size-3" />
          <span>{pr.comments.length}</span>
        </button>
      ) : null}
    </div>
  )
}
