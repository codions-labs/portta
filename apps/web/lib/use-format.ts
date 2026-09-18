'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import * as format from './format.ts'

export function useFormat() {
  const { i18n, t } = useTranslation('common')
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'en'

  return useMemo(
    () => ({
      uptime: (seconds: number | null | undefined) => format.uptime(seconds, t),
      relativeTime: (epochSeconds: number | null | undefined) => format.relativeTime(epochSeconds, t),
      expiresIn: (epochSeconds: number | null | undefined) => format.expiresIn(epochSeconds, t),
      bytes: (value: number | null | undefined) => format.bytes(value, locale, t),
      shortId: format.shortId,
      shortImage: format.shortImage,
      locale,
    }),
    [locale, t],
  )
}
