'use client'

// i18next in the browser, initialised once.
//
// The locale is decided on the server and handed down through the provider, so
// the first paint is already in the right language — a client-side detection
// would render English and then swap, which is a flash on every load.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { type Locale, RESOURCES } from './resources.ts'
import './types.ts'

export const LOCALE_COOKIE = 'portta-locale'

let started = false

export function initI18n(locale: Locale): typeof i18n {
  if (!started) {
    started = true
    void i18n.use(initReactI18next).init({
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      resources: RESOURCES,
    })
  } else if (i18n.language !== locale) {
    void i18n.changeLanguage(locale)
  }
  return i18n
}

/**
 * Remember the choice where the server can read it on the next request.
 *
 * A cookie rather than `localStorage`, because the server renders the first
 * paint and cannot see storage. A year, `SameSite=Lax`, no `Secure` — it is a
 * display preference, and the panel is often plain HTTP on loopback.
 */
export function rememberLocale(locale: Locale): void {
  // biome-ignore lint/suspicious/noDocumentCookie: one display-preference cookie, for the reasons above
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
  document.documentElement.lang = locale
}

export default i18n
