'use client'

import type { ComponentType } from 'react'
import { cn } from '../../lib/utils.ts'

export interface SegmentOption<Value extends string> {
  value: Value
  label: string
  icon?: ComponentType<{ className?: string }>
  /** What marks this one once chosen, when the choice means something. */
  selectedClassName?: string
}

/**
 * A choice between two or three ways of looking at the same rows: board or
 * table, cards or table. One component so the switch sits in the same place,
 * at the same size, on every page that offers one — and so the arrow keys work
 * the same way, which they do not when each page rolls its own pair of buttons.
 *
 * The chosen segment is lifted, not coloured: it is a view, not an action.
 */
export function Segmented<Value extends string>({
  options,
  value,
  onChange,
  label,
  /** Show only the icons; the label stays as the accessible name. */
  iconOnly = false,
  size = 'sm',
  className,
}: {
  options: readonly SegmentOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  label: string
  iconOnly?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md bg-surface-2 p-0.5',
        size === 'sm' ? 'h-8.5' : 'h-10',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-full items-center gap-1.5 rounded-sm text-sm font-medium transition-colors duration-100 focus-ring',
              iconOnly || Icon ? 'px-2 sm:px-2.5' : 'px-2.5',
              selected
                ? cn('bg-surface text-ink shadow-raised', option.selectedClassName)
                : 'text-muted hover:text-ink',
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {iconOnly ? null : Icon ? <span className="hidden sm:inline">{option.label}</span> : option.label}
          </button>
        )
      })}
    </div>
  )
}
