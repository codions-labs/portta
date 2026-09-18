'use client'

// The small pieces an issue is recognised by: its state, its labels, the
// people on it. One place, so a closed issue is the same shade in a table row,
// on the detail page and on the dashboard.

import { CheckCircle2, CircleDot, CircleSlash } from 'lucide-react'
import type { IssueLabel, IssueState, IssueUser } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'

export function IssueStateBadge({
  state,
  reason,
  /** Just the icon, with the word kept for assistive technology: for a dense row. */
  iconOnly = false,
  className,
}: {
  state: IssueState
  /** `not_planned` is closed without being done, and reads differently. */
  reason?: string | null
  iconOnly?: boolean
  className?: string
}) {
  const { t } = useTranslation('issues')
  // `gh` answers GitHub's GraphQL enum, which has been both `NOT_PLANNED` and
  // `not_planned`; Linear puts a state name here, which matches neither.
  const notPlanned = state === 'closed' && reason?.toLowerCase() === 'not_planned'
  const Icon = state === 'open' ? CircleDot : notPlanned ? CircleSlash : CheckCircle2
  const label = state === 'open' ? t('state.open') : notPlanned ? t('stateReason.not_planned') : t('state.closed')
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted', className)}>
      <Icon
        aria-hidden
        className={cn('size-3.5 shrink-0', state === 'open' ? 'text-ok' : notPlanned ? 'text-subtle' : 'text-accent')}
      />
      <span className={cn(iconOnly && 'sr-only')}>{label}</span>
    </span>
  )
}

/**
 * Labels in the provider's own colours: the dot carries the colour, the name
 * stays plain text. A row of eight labels is then still a row of text rather
 * than eight coloured boxes, and a label with no colour is not a hole.
 */
export function IssueLabels({
  labels,
  max = 3,
  className,
}: {
  labels: IssueLabel[]
  max?: number
  className?: string
}) {
  const { t } = useTranslation('issues')
  const shown = labels.slice(0, max)
  const rest = labels.length - shown.length
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <span
          key={label.name}
          title={label.description ?? label.name}
          className="inline-flex h-5 max-w-40 items-center gap-1 rounded-full border border-line bg-surface px-1.5 text-2xs text-muted"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-subtle"
            style={label.color ? { backgroundColor: `#${label.color}` } : undefined}
          />
          <span className="truncate">{label.name}</span>
        </span>
      ))}
      {rest > 0 ? <span className="text-2xs text-subtle">{t('more', { count: rest })}</span> : null}
    </span>
  )
}

export function IssueAssignees({
  assignees,
  max = 3,
  className,
}: {
  assignees: IssueUser[]
  max?: number
  className?: string
}) {
  const { t } = useTranslation('issues')
  const shown = assignees.slice(0, max)
  const rest = assignees.length - shown.length
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted', className)}>
      {shown.map((user) => (
        <span key={user.login} className="truncate" title={user.name ?? user.login}>
          {user.login}
        </span>
      ))}
      {rest > 0 ? <span className="text-2xs text-subtle">{t('more', { count: rest })}</span> : null}
    </span>
  )
}
