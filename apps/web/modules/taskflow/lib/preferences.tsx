'use client'

// What this browser prefers for Taskflow: the chat interface a session opens
// in and the SSH host "Open in Cursor" goes through. Stored locally, never on
// the server. The theme is the panel's; the terminal reads its colours from
// the same tokens and follows it when it changes.

import type { ITheme } from '@xterm/xterm'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { loadSshHost, loadUseWebChatUi, saveSshHost, saveUseWebChatUi } from './utils.ts'

interface Preferences {
  terminalTheme: ITheme
  useWebChatUi: boolean
  setUseWebChatUi: (enabled: boolean) => void
  sshHost: string
  setSshHost: (host: string) => void
}

const PreferencesContext = createContext<Preferences | null>(null)

/** The terminal's colours, read from the tokens the panel's theme resolved to. */
export function terminalThemeFromTokens(): ITheme {
  const styles = getComputedStyle(document.documentElement)
  const colour = (name: string): string => styles.getPropertyValue(name).trim()
  return {
    background: colour('--portta-surface'),
    foreground: colour('--portta-text'),
    cursor: colour('--portta-accent'),
    selectionBackground: colour('--portta-selection'),
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [terminalTheme, setTerminalTheme] = useState<ITheme>({})
  const [useWebChatUi, setUseWebChatUiState] = useState(loadUseWebChatUi)
  const [sshHost, setSshHostState] = useState(loadSshHost)

  useEffect(() => {
    const sync = (): void => setTerminalTheme(terminalThemeFromTokens())
    sync()
    // The panel switches theme by the class on <html>, and "system" follows the OS.
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', sync)
    }
  }, [])

  const setUseWebChatUi = useCallback((enabled: boolean): void => {
    saveUseWebChatUi(enabled)
    setUseWebChatUiState(enabled)
  }, [])

  const setSshHost = useCallback((host: string): void => {
    saveSshHost(host)
    setSshHostState(host.trim())
  }, [])

  const value = useMemo(
    () => ({ terminalTheme, useWebChatUi, setUseWebChatUi, sshHost, setSshHost }),
    [setSshHost, setUseWebChatUi, sshHost, terminalTheme, useWebChatUi],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('PreferencesProvider is not mounted')
  return value
}
