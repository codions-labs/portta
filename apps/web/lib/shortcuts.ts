'use client'

import { useEffect } from 'react'

export interface Shortcut {
  key: string
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod?: boolean
  shift?: boolean
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * A keyboard shortcut, ignored while somebody is typing.
 *
 * Without that check `[` would collapse the sidebar in the middle of a search
 * box, which is the kind of thing that makes people stop using shortcuts.
 */
export function useShortcut(shortcut: Shortcut, run: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return
      if (Boolean(shortcut.mod) !== (event.metaKey || event.ctrlKey)) return
      if (Boolean(shortcut.shift) !== event.shiftKey) return
      if (typing(event.target)) return
      event.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcut.key, shortcut.mod, shortcut.shift, run])
}
