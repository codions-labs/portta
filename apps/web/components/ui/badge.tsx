import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'
import { type Tone, toneBg, toneSoft, toneText } from '../../lib/tone.ts'
import { cn } from '../../lib/utils.ts'

/**
 * A small label: a count, a category, a state that deserves a word.
 *
 * Quiet on purpose. A badge is a soft tint with no border, so a row of them
 * reads as metadata and not as a row of buttons. The `pill` shape is for a
 * label or a state; the default square corners are for a count or a tag.
 */
const badge = cva('inline-flex shrink-0 items-center gap-1 font-medium leading-none whitespace-nowrap', {
  variants: {
    tone: {
      neutral: toneSoft.neutral,
      accent: toneSoft.accent,
      ok: toneSoft.ok,
      warn: toneSoft.warn,
      danger: toneSoft.danger,
      info: toneSoft.info,
      agent: toneSoft.agent,
      /** A hairline and no fill: the least a badge can be. */
      outline: 'border border-line bg-transparent text-subtle',
    },
    size: {
      sm: 'h-5 px-1.5 text-2xs',
      md: 'h-6 px-2 text-xs',
    },
    shape: {
      square: 'rounded-sm',
      pill: 'rounded-full',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'sm', shape: 'square' },
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {
  /** A filled dot in the badge's own tone, for a state that is worth a glance. */
  dot?: boolean
  icon?: ReactNode
}

export function Badge({ className, tone, size, shape, dot, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone, size, shape }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-3">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  )
}

/**
 * A state as a coloured dot, for the places a word would not fit: a row's
 * leading marker, a legend, a count beside a label. Always carries its own
 * accessible name, because a colour alone says nothing to a screen reader.
 */
export function StatusDot({
  tone = 'neutral',
  label,
  pulse = false,
  className,
}: {
  tone?: Tone
  label: string
  /** For something that is happening right now, not merely true right now. */
  pulse?: boolean
  className?: string
}) {
  const colour = toneBg[tone]
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} title={label}>
      {pulse ? (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', colour)}
          aria-hidden
        />
      ) : null}
      <span className={cn('relative inline-flex size-2 rounded-full', colour)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * A state as a dot and a word: `● Running`. The panel's way of saying what
 * a container, an environment or a gateway is doing, in the space a badge
 * would take and with far less ink. Colour is on the dot, never on the word,
 * so a column of them stays legible.
 */
export function StatusIndicator({
  tone = 'neutral',
  children,
  pulse = false,
  size = 'sm',
  emphasis = 'muted',
  className,
  title,
}: {
  tone?: Tone
  children: ReactNode
  pulse?: boolean
  size?: 'sm' | 'md'
  /** `ink` when the state is the row's main fact; `muted` when it is a detail; `tone` when it should shout. */
  emphasis?: 'ink' | 'muted' | 'tone'
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap',
        size === 'sm' ? 'text-xs' : 'text-sm',
        emphasis === 'ink' ? 'text-ink' : emphasis === 'tone' ? toneText[tone] : 'text-muted',
        className,
      )}
    >
      <span className="relative inline-flex size-1.5 shrink-0" aria-hidden>
        {pulse ? (
          <span
            className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', toneBg[tone])}
          />
        ) : null}
        <span className={cn('relative inline-flex size-1.5 rounded-full', toneBg[tone])} />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}
