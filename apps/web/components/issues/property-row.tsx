'use client'

import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { overlayItem } from '../ui/surfaces.ts'

/**
 * One property of an issue in the side panel: a quiet label on the left, the
 * value on the right, the whole row one line tall. The value is a button
 * when it can be changed, and looks like text until the pointer says
 * otherwise, which is what keeps twelve of these from looking like a form.
 */
export function PropertyRow({ label, children, empty }: { label: string; children: ReactNode; empty?: boolean }) {
  return (
    <div className="grid min-h-7 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <dt className="truncate text-xs text-subtle">{label}</dt>
      <dd className={cn('flex min-w-0 items-center text-sm', empty ? 'text-subtle' : 'text-ink')}>{children}</dd>
    </div>
  )
}

export function PropertyButton({
  children,
  disabled,
  empty,
}: {
  children: ReactNode
  disabled?: boolean
  empty?: boolean
}) {
  return (
    <PopoverTrigger
      disabled={disabled}
      className={cn(
        '-ml-1.5 inline-flex h-7 max-w-full items-center rounded-md px-1.5 text-left text-sm transition-colors duration-100 focus-ring',
        'hover:bg-fill data-[state=open]:bg-fill',
        empty ? 'text-subtle hover:text-muted' : 'text-ink',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </PopoverTrigger>
  )
}

export function PropertyMenu({
  label,
  value,
  empty,
  disabled,
  children,
}: {
  label: string
  value: ReactNode
  empty?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <PropertyRow label={label} empty={empty}>
      <Popover>
        <PropertyButton disabled={disabled} empty={empty}>
          {value}
        </PropertyButton>
        <PopoverContent padding="list" className="w-56">
          {children}
        </PopoverContent>
      </Popover>
    </PropertyRow>
  )
}

export function PropertyChoice({
  children,
  selected,
  onSelect,
}: {
  children: ReactNode
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(overlayItem, 'w-full pr-7 hover:bg-fill focus-ring-inset', selected && 'bg-fill')}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {selected ? <Check className="absolute right-2 size-3.5 text-accent" aria-hidden /> : null}
    </button>
  )
}
