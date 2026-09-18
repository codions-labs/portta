'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useRef } from 'react'
import { cn } from '../../lib/utils.ts'

export interface TabDefinition {
  id: string
  label: string
  /** The path this tab is. A tab is a URL, never component state. */
  href: string
  /** A number beside the label: how many of the thing the tab shows. */
  count?: number
}

/**
 * A tab list that navigates instead of holding state.
 *
 * Each tab is a link, so a tab is addressable, survives a reload and moves with
 * the browser's back button. Radix is already a dependency for dialog, menu and
 * switch; a link list needs twenty lines and no fourth package.
 *
 * Every tab has the same weight whether selected or not, so choosing one
 * never shifts its neighbours.
 */
export function Tabs({
  tabs,
  active,
  label,
  className,
}: {
  tabs: TabDefinition[]
  active: string
  label: string
  className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const router = useRouter()

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()

    const index = tabs.findIndex((tab) => tab.id === active)
    const last = tabs.length - 1
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? index <= 0
              ? last
              : index - 1
            : index >= last
              ? 0
              : index + 1

    const target = tabs[next]
    if (!target) return
    router.push(target.href)
    // Roving focus follows the selection, which is what a tablist promises.
    list.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus()
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('-mb-px flex gap-0.5 overflow-x-auto border-b border-line scroll-thin', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <Link
            key={tab.id}
            role="tab"
            data-tab={tab.id}
            href={tab.href}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              'relative flex h-9 shrink-0 items-center gap-1.5 rounded-t-sm px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-100 focus-ring-inset',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors',
              selected ? 'text-ink after:bg-accent' : 'text-subtle hover:text-ink after:bg-transparent',
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn('text-xs tabular-nums', selected ? 'text-subtle' : 'text-faint')}>{tab.count}</span>
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="pt-4 outline-none">
      {children}
    </div>
  )
}
