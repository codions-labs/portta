'use client'

import * as Primitive from '@radix-ui/react-switch'
import { cn } from '../../lib/utils.ts'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  size = 'md',
  'aria-label': label,
  'aria-labelledby': labelledBy,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  return (
    <Primitive.Root
      id={id}
      aria-label={label}
      aria-labelledby={labelledBy}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-100 focus-ring',
        size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
        'bg-fill-strong data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <Primitive.Thumb
        className={cn(
          'block rounded-full bg-accent-fg shadow-[0_1px_2px_oklch(0_0_0/0.25)] transition-transform duration-150',
          size === 'sm'
            ? 'size-3 translate-x-0.5 data-[state=checked]:translate-x-3.5'
            : 'size-4 translate-x-0.5 data-[state=checked]:translate-x-4',
        )}
      />
    </Primitive.Root>
  )
}
