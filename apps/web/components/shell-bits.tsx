'use client'

import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import type { ComponentType, HTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { translateApiError, translateApiHint } from '@/lib/i18n/translate-error.ts'
import { type Tone, toneBorder, toneText, toneWash } from '../lib/tone.ts'
import { cn } from '../lib/utils.ts'
import { DocText } from './doc-text.tsx'
import { Breadcrumb, type BreadcrumbItem } from './ui/breadcrumb.tsx'
import { Checkbox, type CheckboxProps, Input, type InputProps, Select, type SelectProps } from './ui/field.tsx'

/**
 * The top of every page: where it sits, what it is called, what can be done
 * to it. Kept short on purpose. A header that is a third of the screen is a
 * header the operator scrolls past forty times a day.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  /** A compact status strip that belongs to the page, under the title. */
  meta,
  icon,
}: {
  title: string
  description?: ReactNode
  /** Page verbs: the one primary action, `md`. Never a filter, never a view switcher. */
  actions?: ReactNode
  /** Where the page sits; shown above the title when it has at least two steps. */
  breadcrumb?: BreadcrumbItem[]
  meta?: ReactNode
  icon?: ReactNode
}) {
  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          {breadcrumb && breadcrumb.length >= 2 ? <Breadcrumb items={breadcrumb} className="-ml-1 mb-1" /> : null}
          <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-ink">
            {icon ? <span className="shrink-0 text-subtle [&_svg]:size-4">{icon}</span> : null}
            <span className="truncate">{title}</span>
          </h1>
          {description ? <p className="mt-0.5 max-w-3xl text-sm text-subtle">{description}</p> : null}
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">{meta}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

/** A row of controls above a list: search, filters, page-level scope. */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)} {...props} />
}

/**
 * The row above a list: the view switcher first, then the filters that shape
 * the rows, then what belongs at the right edge (the column menu of a table,
 * a read-only badge). It is one row in one place, in every view: switching
 * cards to a table changes what is under the row, never the row.
 */
export function ViewToolbar({
  switcher,
  children,
  trailing,
  className,
}: {
  switcher?: ReactNode
  children?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <Toolbar className={cn('mb-3', className)}>
      {switcher}
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </Toolbar>
  )
}

/**
 * The controls a toolbar is made of, at the toolbar's one size (28px) and
 * one set of widths, so a search box is the same search box on every page.
 */
export function ToolbarSearch({ className, ...props }: Omit<InputProps, 'size'>) {
  return <Input type="search" size="sm" className={cn('w-64', className)} {...props} />
}

export function ToolbarSelect({
  width = 'md',
  className,
  ...props
}: Omit<SelectProps, 'size'> & {
  /** `lg` for a sentence-long first option ("Qualquer prioridade"). */
  width?: 'md' | 'lg'
}) {
  return <Select size="sm" className={cn(width === 'lg' ? 'w-40' : 'w-36', className)} {...props} />
}

export function ToolbarCheck({ children, className, ...props }: CheckboxProps & { children: ReactNode }) {
  return (
    <label className={cn('flex h-7 shrink-0 items-center gap-1.5 text-xs text-muted', className)}>
      <Checkbox {...props} />
      {children}
    </label>
  )
}

/**
 * A heading inside a page: a section of a project, a group on a settings page.
 * One size, so the eye learns it once.
 */
export function SectionHeader({
  title,
  count,
  description,
  actions,
  as: Heading = 'h2',
  className,
}: {
  title: ReactNode
  count?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={cn('flex min-h-7 items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="truncate">{title}</span>
          {count !== undefined && count !== null ? (
            <span className="text-xs text-subtle tabular-nums">{count}</span>
          ) : null}
        </Heading>
        {description ? <p className="text-xs text-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

/** The small label above a value or a group: `Status`, `Repository`. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <span className={cn('block text-2xs font-medium text-subtle', className)} {...props} />
}

/** A cell with nothing in it, said the same way everywhere. */
export function NoValue({ className }: { className?: string }) {
  return (
    <span className={cn('text-faint', className)} aria-hidden>
      —
    </span>
  )
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation('common')
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-8 text-sm text-subtle">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? t('loading')}
    </div>
  )
}

/**
 * The shape of content that has not arrived, so a card does not collapse and
 * then jump. Used where the wait is long enough to see; a spinner is enough
 * for anything shorter.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-sm bg-fill-strong', className)} />
}

export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  const { t } = useTranslation('common')
  return (
    <div role="status" aria-label={t('loading')} className={cn('space-y-2.5 px-3 py-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * A short notice with a tone: an error, a warning, something worth knowing.
 * One shape for all of them, so the tone is the only thing that changes.
 */
export function Callout({
  tone = 'neutral',
  title,
  children,
  icon,
  actions,
  className,
  role,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  icon?: ReactNode | false
  actions?: ReactNode
  className?: string
  role?: 'alert' | 'status'
}) {
  const Default = tone === 'danger' ? XCircle : tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm',
        toneBorder[tone],
        toneWash[tone],
        className,
      )}
    >
      {icon === false ? null : (
        <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', toneText[tone])} aria-hidden>
          {icon ?? <Default />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title ? (
          <div className={cn('font-medium', tone === 'neutral' ? 'text-ink' : toneText[tone])}>{title}</div>
        ) : null}
        {children ? <div className={cn('text-muted', title && 'mt-0.5 text-xs')}>{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const raw = error instanceof Error ? error.message : String(error)
  const hint = (error as { hint?: string })?.hint
  const message = translateApiError(raw, hint, t)
  const translatedHint = hint ? translateApiHint(hint, t) : undefined
  return (
    <Callout tone="danger" role="alert" title={message}>
      {translatedHint && translatedHint !== message ? <DocText>{translatedHint}</DocText> : null}
    </Callout>
  )
}

/**
 * A section with nothing in it yet.
 *
 * It says what the section is for and, where there is one, offers the action
 * that would fill it. `compact` is for a panel inside a dashboard: an empty
 * slot on a cockpit must not cost more space than a full one.
 */
export function Empty({
  title,
  hint,
  icon: Icon,
  action,
  compact = false,
  tone = 'neutral',
}: {
  title: string
  hint?: ReactNode
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  compact?: boolean
  /** `ok` states the absence is good news: nothing needs attention. */
  tone?: 'neutral' | 'ok'
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-sm">
        {Icon ? <Icon className={cn('size-4 shrink-0', tone === 'ok' ? 'text-ok' : 'text-faint')} aria-hidden /> : null}
        <span className={tone === 'ok' ? 'text-ok' : 'text-subtle'}>{title}</span>
        {hint ? (
          <span className="hidden text-xs text-faint sm:inline">
            {typeof hint === 'string' ? <DocText>{hint}</DocText> : hint}
          </span>
        ) : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
    )
  }
  return (
    <div className="px-4 py-8 text-center">
      {Icon ? (
        <span className="mx-auto mb-2 flex size-8 items-center justify-center rounded-md border border-line bg-surface-2">
          <Icon className={cn('size-4', tone === 'ok' ? 'text-ok' : 'text-subtle')} aria-hidden />
        </span>
      ) : null}
      <p className={cn('text-sm font-medium', tone === 'ok' ? 'text-ok' : 'text-muted')}>{title}</p>
      {hint ? (
        <p className="mx-auto mt-1 max-w-md text-xs text-subtle">
          {typeof hint === 'string' ? <DocText>{hint}</DocText> : hint}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: ReactNode
  tone?: 'ok' | 'warn' | 'danger' | 'accent'
  hint?: string
}) {
  const color = tone ? toneText[tone] : 'text-ink'
  return (
    <div role="group" aria-label={label} className="rounded-lg border border-line bg-surface px-3 py-2">
      <Eyebrow>{label}</Eyebrow>
      <div data-slot="value" className={cn('mt-1 text-xl leading-none font-semibold tabular-nums', color)}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-subtle">{hint}</div> : null}
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="w-36 shrink-0 text-xs text-subtle">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  )
}
