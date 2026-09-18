'use client'

import * as Primitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'
import { Shortcut } from './kbd.tsx'
import { overlayEnter, overlayItem, overlayLabel, overlaySeparator, overlaySurface } from './surfaces.ts'

export const Menu = Primitive.Root
export const MenuTrigger = Primitive.Trigger
export const MenuRadioGroup = Primitive.RadioGroup

export function MenuContent({
  children,
  align = 'end',
  side,
  className,
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
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
          'z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] min-w-44 overflow-y-auto p-1 scroll-thin',
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

/** Names what the items below it are for, when a menu holds more than one group. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <Primitive.Label className={overlayLabel}>{children}</Primitive.Label>
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  tone,
  icon,
  /** Shown dimmed at the end of the row: a count, a state. */
  hint,
  /** The keys that do the same thing without the menu. */
  shortcut,
  title,
  className,
}: {
  children: ReactNode
  onSelect?: () => void
  disabled?: boolean
  tone?: 'danger'
  icon?: ReactNode
  hint?: ReactNode
  shortcut?: readonly string[]
  title?: string
  className?: string
}) {
  return (
    <Primitive.Item
      disabled={disabled}
      onSelect={onSelect}
      title={title}
      className={cn(
        overlayItem,
        tone === 'danger' && 'text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger',
        className,
      )}
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-2xs text-subtle">{hint}</span> : null}
      {shortcut ? <Shortcut keys={shortcut} className="ml-2" /> : null}
    </Primitive.Item>
  )
}

/** An item that is on or off and keeps the menu open: a column, a filter. */
export function MenuToggle({
  children,
  checked,
  onCheckedChange,
  disabled,
}: {
  children: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <Primitive.CheckboxItem
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      className={cn(overlayItem, 'pl-7')}
    >
      <Primitive.ItemIndicator className="absolute left-2 flex items-center">
        <Check className="size-3.5 text-accent" />
      </Primitive.ItemIndicator>
      {children}
    </Primitive.CheckboxItem>
  )
}

/** One of a set: a sort order, a theme. */
export function MenuRadio({
  children,
  value,
  disabled,
  icon,
}: {
  children: ReactNode
  value: string
  disabled?: boolean
  icon?: ReactNode
}) {
  return (
    <Primitive.RadioItem value={value} disabled={disabled} className={cn(overlayItem, 'pl-7')}>
      <Primitive.ItemIndicator className="absolute left-2 flex items-center">
        <Check className="size-3.5 text-accent" />
      </Primitive.ItemIndicator>
      {icon}
      {children}
    </Primitive.RadioItem>
  )
}

export function MenuSeparator() {
  return <Primitive.Separator className={overlaySeparator} />
}
