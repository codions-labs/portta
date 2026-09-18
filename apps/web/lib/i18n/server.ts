// The locale a request is in, and a `t` for a Server Component.
//
// One i18next instance per request rather than a shared one: a module-level
// instance would carry whichever language the last request set into the next
// one, and two people with different preferences would see each other's.

import 'server-only'
import { createInstance, type i18n as I18n } from 'i18next'
import { cookies, headers } from 'next/headers'
import { type Locale, normaliseLocale, RESOURCES } from './resources.ts'

export const LOCALE_COOKIE = 'portta-locale'

/**
 * The cookie the panel set, else what the browser asked for, else English.
 *
 * `Accept-Language` is read in order and the first understood tag wins, which
 * is what makes a Brazilian browser land on Portuguese without ever having
 * opened the menu.
 */
export async function requestLocale(): Promise<Locale> {
  const chosen = normaliseLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  if (chosen) return chosen

  const accept = (await headers()).get('accept-language') ?? ''
  for (const part of accept.split(',')) {
    const tag = normaliseLocale(part.split(';')[0]?.trim())
    if (tag) return tag
  }
  return 'en'
}

/**
 * A key in one namespace. The panel's augmented `TFunction` types keys as
 * `namespace:key`, which is right inside a component that named no namespace
 * and wrong here, where the namespace is the argument.
 */
export type ServerT = (key: string, options?: Record<string, unknown>) => string

/** A translator for this request, in the namespace the caller names. */
export async function serverTranslation(
  namespace: keyof typeof RESOURCES.en = 'common',
): Promise<{ t: ServerT; locale: Locale; i18n: I18n }> {
  const locale = await requestLocale()
  const instance = createInstance()
  await instance.init({
    lng: locale,
    fallbackLng: 'en',
    defaultNS: namespace,
    interpolation: { escapeValue: false },
    resources: RESOURCES,
  })
  return { t: instance.getFixedT(locale, namespace) as unknown as ServerT, locale, i18n: instance }
}
