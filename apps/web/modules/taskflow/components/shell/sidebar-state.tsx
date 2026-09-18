'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface SidebarState {
  isMobile: boolean
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  /** Picking something on a phone hides the sidebar that was covering the page. */
  closeOnMobile: () => void
}

const SidebarStateContext = createContext<SidebarState | null>(null)

const MOBILE_QUERY = '(max-width: 768px)'

/** Whether the viewport is a phone and, if so, whether the sidebar covers the page. */
export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY)
    setIsMobile(mediaQuery.matches)
    if (mediaQuery.matches) setSidebarOpen(true)
    const onChange = (event: MediaQueryListEvent): void => setIsMobile(event.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), [])
  const closeOnMobile = useCallback(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile])

  const value = useMemo(
    () => ({ isMobile, sidebarOpen, setSidebarOpen, toggleSidebar, closeOnMobile }),
    [closeOnMobile, isMobile, sidebarOpen, toggleSidebar],
  )
  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>
}

export function useSidebarState(): SidebarState {
  const value = useContext(SidebarStateContext)
  if (!value) throw new Error('SidebarStateProvider is not mounted')
  return value
}
