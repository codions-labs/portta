'use client'

import { type ReactNode, useSyncExternalStore } from 'react'
import { cn } from '../../lib/utils.ts'

/** Nothing ever changes the platform, so the store never has to notify. */
const never = () => () => {}

/**
 * The modifier key as the platform writes it: `⌘` on Apple hardware, `Ctrl`
 * everywhere else.
 *
 * A hook rather than a module constant, because the panel renders on a server
 * that is nearly always Linux and is read on a machine that is often not. Read
 * at import time it made the HTML say `Ctrl` and the first client render say
 * `⌘`, which is a hydration mismatch — and React answers one by throwing the
 * server's tree away and rebuilding the whole panel in the browser.
 *
 * `useSyncExternalStore` is the sanctioned way to say "the server cannot know
 * this": it hands React the server's answer while it hydrates and the real one
 * on the render immediately after, so the only cost is a re-render nobody sees.
 */
export function useModKey(): string {
  return useSyncExternalStore(
    never,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  )
}

/**
 * A key, drawn as a key. Used in menus, in the command palette and in
 * tooltips so a shortcut is discoverable where the action is.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-xs border border-line bg-surface-2 px-1',
        'font-sans text-2xs font-medium text-subtle tabular-nums',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** `⌘ K`, `G then P`: a sequence of keys with the spacing the eye expects. */
export function Shortcut({ keys, className }: { keys: readonly string[]; className?: string }) {
  const mod = useModKey()
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-hidden>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key === 'mod' ? mod : key}</Kbd>
      ))}
    </span>
  )
}
