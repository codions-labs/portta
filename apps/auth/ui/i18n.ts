// The ForwardAuth login page's own strings, one file per locale.
//
// `apps/auth` may not import from the panel: it is a separate service on a
// separate origin, and a protected project must work whether or not the panel
// is even installed. The two files hold this page's copy only; the panel's
// sign-in copy lives with the panel.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './messages/en.json' with { type: 'json' }
import ptBR from './messages/pt-BR.json' with { type: 'json' }

export function initializeAuthI18n(locale: 'en' | 'pt-BR') {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { auth: en }, 'pt-BR': { auth: ptBR } },
      defaultNS: 'auth',
      interpolation: { escapeValue: false },
    })
  } else void i18n.changeLanguage(locale)
  return i18n
}
