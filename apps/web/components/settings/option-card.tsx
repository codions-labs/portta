'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One choice out of a few, with room to say what it means. */
export function OptionCard({
  name,
  checked,
  disabled = false,
  onSelect,
  title,
  help,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  title: ReactNode
  help?: ReactNode
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-xl border bg-surface px-3.5 py-3 transition-colors duration-100',
        checked ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-line',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-fill',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 size-4.5 shrink-0 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2',
          checked ? 'border-[5px] border-accent' : 'border-2 border-line-strong',
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        {help ? <span className="block text-sm text-subtle">{help}</span> : null}
      </span>
    </label>
  )
}
