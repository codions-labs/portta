'use client'

import { useTranslation } from 'react-i18next'
import type { PrEntry } from '../../lib/types.ts'
import { cn, isDraftPr, prBadgeClass, prLabel } from '../../lib/utils.ts'

interface PrBadgeProps {
  pr: PrEntry
  clickable?: boolean
}

export function PrBadge({ pr, clickable = false }: PrBadgeProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'pr' })
  const label = prLabel(pr)
  const title = isDraftPr(pr) ? t('draft') : t(`state.${pr.state}`, { defaultValue: pr.state })
  const className = cn(
    'inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-2xs font-medium',
    prBadgeClass(pr),
  )

  if (clickable && pr.url) {
    return (
      <a
        href={pr.url}
        target="_blank"
        rel="noopener"
        className={cn(className, 'focus-ring no-underline hover:opacity-80')}
        title={title}
      >
        {label}
      </a>
    )
  }

  return (
    <span className={className} title={title}>
      {label}
    </span>
  )
}
