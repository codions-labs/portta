'use client'

import * as Primitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'
import { overlayEnter, overlaySurface } from './surfaces.ts'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverClose = Primitive.Close

/**
 * A small floating panel anchored to what opened it: a property editor, a
 * date, a short form. It shares its surface with the menu; only the padding
 * differs, because a popover holds content and a menu holds rows.
 */
export function PopoverContent({
  children,
  align = 'start',
  side = 'bottom',
  /** `list` for a popover made of menu-like rows, `panel` for content. */
  padding = 'panel',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  padding?: 'list' | 'panel' | 'none'
  className?: string
}) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        side={side}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'z-50 min-w-44 outline-none',
          'max-h-[min(32rem,var(--radix-popover-content-available-height))] overflow-y-auto scroll-thin',
          padding === 'list' ? 'p-1' : padding === 'panel' ? 'p-3' : '',
          overlaySurface,
          overlayEnter,
          className,
        )}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
