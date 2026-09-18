'use client'

import { Check, Copy, ExternalLink } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopy } from '../lib/clipboard.ts'
import { cn } from '../lib/utils.ts'
import { Button } from './ui/button.tsx'

export function CopyButton({
  value,
  label,
  size = 'icon-sm',
  className,
}: {
  value: string
  label?: string
  size?: 'icon' | 'icon-sm' | 'icon-xs'
  className?: string
}) {
  const { t } = useTranslation('common')
  const { copied, copy } = useCopy()
  const done = copied === value
  const copyLabel = label ?? t('copy')
  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      title={done ? t('copied') : copyLabel}
      aria-label={done ? t('copied') : copyLabel}
      onClick={() => copy(value)}
    >
      {done ? <Check className="text-ok" /> : <Copy />}
    </Button>
  )
}

export type MonoKind = 'text' | 'path' | 'port' | 'url' | 'sha' | 'branch' | 'command' | 'id' | 'host'

/**
 * A technical value: a path, a port, a hash, a branch. Set in the mono face
 * at the size of the text around it, one shade quieter, and truncated or
 * broken the way that kind of value should be. Say what it is, and the
 * component does the rest.
 */
export function Mono({
  value,
  kind = 'text',
  children,
  className,
  tone = 'muted',
  title,
}: {
  value?: string
  kind?: MonoKind
  children?: ReactNode
  className?: string
  tone?: 'ink' | 'muted' | 'subtle'
  title?: string
}) {
  const overflow =
    kind === 'url' || kind === 'path' || kind === 'command' ? 'min-w-0 truncate' : kind === 'sha' ? 'tabular-nums' : ''
  return (
    <span
      title={title ?? (kind === 'url' || kind === 'path' ? value : undefined)}
      className={cn(
        'font-mono text-[0.92em]',
        tone === 'ink' ? 'text-ink' : tone === 'subtle' ? 'text-subtle' : 'text-muted',
        overflow,
        className,
      )}
    >
      {children ?? value}
    </span>
  )
}

/** A short value in a chip: an env key, a hostname, a command. */
export function CodeChip({
  children,
  className,
  tone = 'ink',
  title,
}: {
  children: ReactNode
  className?: string
  tone?: 'ink' | 'muted'
  title?: string
}) {
  return (
    <code
      title={title}
      className={cn(
        'inline-flex max-w-full items-center rounded-sm border border-line bg-surface-2 px-1.5 py-px font-mono text-[0.85em] leading-[1.6]',
        tone === 'ink' ? 'text-ink' : 'text-muted',
        className,
      )}
    >
      {children}
    </code>
  )
}

/** A command the operator will paste into a terminal, and the button that copies it. */
export function CommandRow({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-md border border-line bg-surface-2 py-1 pr-1 pl-2.5',
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{command}</code>
      <CopyButton value={command} />
    </div>
  )
}

/** A block of output: a log tail, a stack, a file. */
export function Pre({
  children,
  className,
  maxHeight = 'max-h-64',
  ...props
}: { children: ReactNode; className?: string; maxHeight?: string } & Omit<
  HTMLAttributes<HTMLPreElement>,
  'children' | 'className'
>) {
  return (
    <pre
      {...props}
      className={cn(
        'overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre text-ink scroll-thin',
        maxHeight,
        className,
      )}
    >
      {children}
    </pre>
  )
}

/** A copyable, openable address. Used everywhere a URL appears. */
export function AddressLine({ value, href, className }: { value: string; href?: string; className?: string }) {
  const { t } = useTranslation('common')
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-0.5', className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="truncate rounded-xs font-mono text-xs text-accent hover:underline focus-ring"
        >
          {value}
        </a>
      ) : (
        <Mono value={value} kind="url" tone="ink" className="text-xs" />
      )}
      <CopyButton value={value} />
      {href ? (
        <Button asChild variant="ghost" size="icon-sm">
          <a href={href} target="_blank" rel="noreferrer" title={t('open')} aria-label={t('open')}>
            <ExternalLink />
          </a>
        </Button>
      ) : null}
    </span>
  )
}
