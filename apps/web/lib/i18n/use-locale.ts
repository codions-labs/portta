'use client'

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { rememberLocale } from './client.ts'
import type { Locale } from './resources.ts'

export type { Locale }

/**
 * The language the panel is in, and how to change it.
 *
 * Changing it writes a cookie as well as switching i18next, because the server
 * renders the first paint of the next navigation and reads the cookie to decide
 * what language to render it in.
 */
export function useLocale(): [Locale, (locale: Locale) => void] {
  const { i18n } = useTranslation()
  const current: Locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'en'

  const change = useCallback(
    (next: Locale) => {
      void i18n.changeLanguage(next)
      rememberLocale(next)
    },
    [i18n],
  )

  return [current, change]
}
