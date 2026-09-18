'use client'

import { useCallback, useRef, useState } from 'react'

/** Local HTTP installations may not expose the asynchronous Clipboard API. */
export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      /* Fall back to a user-initiated copy. */
    }
  }
  const focused = document.activeElement
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard is unavailable')
  } finally {
    area.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
  }
}

/** Copying a URL or a connection string is the panel's most-used action. */
export function useCopy(): { copied: string | null; copy: (value: string, key?: string) => void } {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback((value: string, key?: string) => {
    const mark = () => {
      setCopied(key ?? value)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 1400)
    }

    void copyText(value).then(mark, () => {})
  }, [])

  return { copied, copy }
}
