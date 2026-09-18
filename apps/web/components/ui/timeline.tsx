import type { ReactNode } from 'react'
import { type Tone, toneBg } from '../../lib/tone.ts'
import { cn } from '../../lib/utils.ts'

/** An ordered list with a rail: what happened, in the order it happened. */
export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn('relative ml-2 space-y-0 border-l border-line pl-5', className)}>{children}</ol>
}

export function TimelineItem({
  marker,
  time,
  children,
  tone = 'neutral',
}: {
  /** An icon in place of the dot: the kind of event, when the kind matters. */
  marker?: ReactNode
  time?: ReactNode
  children: ReactNode
  tone?: Tone
}) {
  return (
    <li className="relative py-1.5 text-sm">
      {marker ? (
        <span
          className={cn(
            'absolute top-1.5 -left-[0.5625rem] flex size-4 items-center justify-center rounded-full bg-surface ring-2 ring-surface [&_svg]:size-3',
            toneBg[tone] === 'bg-subtle' ? 'text-subtle' : toneBg[tone].replace('bg-', 'text-'),
          )}
          aria-hidden
        >
          {marker}
        </span>
      ) : (
        <span
          className={cn('absolute top-2.5 -left-[0.3125rem] size-2 rounded-full ring-2 ring-surface', toneBg[tone])}
          aria-hidden
        />
      )}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {time ? <span className="shrink-0 text-2xs text-subtle tabular-nums">{time}</span> : null}
        <div className="min-w-0 flex-1 text-ink">{children}</div>
      </div>
    </li>
  )
}
