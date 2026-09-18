import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useModKey } from '@/components/ui/kbd'
import { ThemeProvider, useDarkTheme, useThemeChoice } from '@/lib/theme'
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme-script'

// What the panel renders on the server and what the browser renders on its
// first pass have to be the same string. When they are not, React throws the
// server's tree away and rebuilds the whole panel in the browser — which is
// what the modifier key and the theme icon each used to do, one on a Mac and
// the other on any machine that had ever chosen a theme.
//
// `renderToString` is the server's answer. `render` is the browser's, one
// render later. Every hook here has to be able to give both.

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

function onMac<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: MAC })
  try {
    return run()
  } finally {
    Object.defineProperty(navigator, 'userAgent', original ?? { configurable: true, value: undefined })
  }
}

function Mod() {
  return <span data-testid="mod">{useModKey()}</span>
}

function Dark() {
  return <span data-testid="dark">{String(useDarkTheme())}</span>
}

function Choice() {
  return <span data-testid="choice">{useThemeChoice().theme}</span>
}

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.style.colorScheme = ''
})

describe('the modifier key', () => {
  it('is Ctrl on the server, on a Mac as much as anywhere', () => {
    onMac(() => {
      expect(renderToString(<Mod />)).toContain('Ctrl')
      expect(renderToString(<Mod />)).not.toContain('⌘')
    })
  })

  it('is the platform key once the browser has it', () => {
    onMac(() => {
      render(<Mod />)
      expect(screen.getByTestId('mod')).toHaveTextContent('⌘')
    })
  })
})

describe('the theme', () => {
  it('is whatever the machine says until the browser has read its storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const tree = (
      <ThemeProvider>
        <Choice />
      </ThemeProvider>
    )
    expect(renderToString(tree)).toContain('system')
    render(tree)
    expect(screen.getByTestId('choice')).toHaveTextContent('dark')
  })

  it('is light on the server even when the browser will call it dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const tree = (
      <ThemeProvider>
        <Dark />
      </ThemeProvider>
    )
    expect(renderToString(tree)).toContain('false')
    render(tree)
    expect(screen.getByTestId('dark')).toHaveTextContent('true')
  })

  it('applies the stored theme before React paints', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    document.documentElement.classList.remove('light', 'dark')
    // The same IIFE ThemeProvider inserts into <head>. Running it here is the
    // proof that the string we ship actually paints the class.
    Function(THEME_INIT_SCRIPT)()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('uses the system theme before paint when storage is unavailable', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
    }
    const darkSystem = () => ({ matches: true })
    Function('localStorage', 'matchMedia', 'document', THEME_INIT_SCRIPT)(unavailableStorage, darkSystem, document)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('returns to the system theme when another tab clears storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(
      <ThemeProvider>
        <Choice />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('choice')).toHaveTextContent('dark')

    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })))

    expect(screen.getByTestId('choice')).toHaveTextContent('system')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})
