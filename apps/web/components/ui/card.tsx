import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

/**
 * A bounded surface. A hairline and nothing else: the card is the same colour
 * as the page it sits on, and its edge is what separates the two.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)} {...props} />
}

export function CardHeader({
  title,
  description,
  actions,
  /** A number, a state, an age: what the header is worth knowing at a glance. */
  meta,
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-9 items-center justify-between gap-3 border-b border-line px-3 py-1.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="shrink-0 text-subtle [&_svg]:size-4">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {title}
            {meta}
          </h2>
          {description ? <p className="text-xs text-subtle">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-3 py-2.5', className)} {...props} />
}

/**
 * A labelled band inside a card, for a list that has more than one part —
 * the groups of an activity feed, the sections of a settings page. The label is
 * quieter than a card header on purpose: it is a divider, not a title.
 */
export function CardSection({
  label,
  count,
  actions,
  icon,
  children,
  className,
}: {
  label: ReactNode
  count?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex h-8 items-center gap-2 border-t border-line bg-surface-2/60 px-3 text-xs font-medium text-muted first:border-t-0">
        {icon ? <span className="shrink-0 text-subtle [&_svg]:size-3.5">{icon}</span> : null}
        <span className="min-w-0 truncate">{label}</span>
        {count !== undefined && count !== null ? <span className="text-subtle tabular-nums">{count}</span> : null}
        {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
      </div>
      {children}
    </div>
  )
}
