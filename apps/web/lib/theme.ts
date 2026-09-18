'use client'

// The theme, read in a way that survives hydration.
//
// The blocking script in the document head paints the class before React
// runs. These hooks still have to answer the same thing on the server and on
// the first client render: `system`, not dark, until hydration has finished.
// A component that draws an icon from storage on that first pass renders two
// different icons, React calls it a hydration mismatch, and its answer is to
// throw the server's tree away and rebuild the whole panel in the browser.
//
// The provider itself never renders a <script>. React 19 would warn, and the
// tag would not execute on the client anyway.

import { useServerInsertedHTML } from 'next/navigation'
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme-script'

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]
type ResolvedTheme = 'light' | 'dark'

function isTheme(value: string | undefined | null): value is Theme {
  return value !== undefined && value !== null && (THEMES as readonly string[]).includes(value)
}

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light'
  return theme
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (isTheme(stored)) return stored
  } catch {
    // Private mode can refuse storage. `system` is the honest default.
  }
  return 'system'
}

function disableTransitions(): () => void {
  const style = document.createElement('style')
  style.appendChild(document.createTextNode('*,*::before,*::after{transition:none!important}'))
  document.head.appendChild(style)
  return () => {
    window.getComputedStyle(document.body)
    setTimeout(() => style.remove(), 1)
  }
}

function applyTheme(theme: Theme): ResolvedTheme {
  const restore = disableTransitions()
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  restore()
  return resolved
}

type ThemeContextValue = {
  theme: Theme
  setTheme: (value: Theme) => void
  resolvedTheme: ResolvedTheme
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function ThemeInit() {
  // Next splices this into <head> during SSR. The callback never runs on the
  // client, so React 19 never sees a <script> in the hydrating tree.
  const inserted = useRef(false)
  useServerInsertedHTML(() => {
    if (inserted.current) return null
    inserted.current = true
    return createElement('script', {
      id: 'portta-theme-init',
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, inlined so the first paint already has the right theme
      dangerouslySetInnerHTML: { __html: THEME_INIT_SCRIPT },
    })
  })
  return null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (typeof window === 'undefined' ? 'system' : readStoredTheme()))
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(theme),
  )
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    const stored = readStoredTheme()
    themeRef.current = stored
    setThemeState(stored)
    setResolvedTheme(applyTheme(stored))

    let media: MediaQueryList | undefined
    const onMedia = () => {
      if (themeRef.current !== 'system') return
      setResolvedTheme(applyTheme('system'))
    }
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', onMedia)
    } catch {
      media = undefined
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      const next = isTheme(event.newValue) ? event.newValue : 'system'
      themeRef.current = next
      setThemeState(next)
      setResolvedTheme(applyTheme(next))
    }
    window.addEventListener('storage', onStorage)

    return () => {
      media?.removeEventListener('change', onMedia)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setTheme = useCallback((value: Theme) => {
    themeRef.current = value
    setThemeState(value)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      // Same as a read that failed: the page still changes for this session.
    }
    setResolvedTheme(applyTheme(value))
  }, [])

  const value = useMemo(() => ({ theme, setTheme, resolvedTheme }), [theme, setTheme, resolvedTheme])

  return createElement(ThemeContext.Provider, { value }, createElement(ThemeInit), children)
}

function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  return value ?? { theme: 'system', setTheme: () => {}, resolvedTheme: 'light' }
}

/** Hydration happens once and never unhappens, so nothing has to notify. */
const never = () => () => {}

/** False on the server and while React hydrates; true from then on. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  )
}

/**
 * The chosen theme and how to change it. `system` until the browser has read
 * its storage, which is also the honest answer for a page nobody has visited.
 */
export function useThemeChoice(): { theme: Theme; setTheme: (value: Theme) => void } {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  return { theme: hydrated && isTheme(theme) ? theme : 'system', setTheme }
}

/** Whether the panel is dark right now. False until the browser has said. */
export function useDarkTheme(): boolean {
  const { resolvedTheme } = useTheme()
  return useHydrated() && resolvedTheme === 'dark'
}
