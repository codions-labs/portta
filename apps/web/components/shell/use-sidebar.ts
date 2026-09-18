'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'portta-sidebar'

/**
 * Whether the rail is collapsed.
 *
 * Read after mount, never during render: the server has no `localStorage`, and
 * reading it while rendering would make the first client paint disagree with
 * the HTML the server sent.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === 'collapsed')
    } catch {
      /* private browsing: the panel opens expanded */
    }
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
      } catch {
        /* private browsing: the choice simply does not persist */
      }
      return next
    })
  }, [])

  return [collapsed, toggle]
}
