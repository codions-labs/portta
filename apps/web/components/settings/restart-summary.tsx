'use client'

import type { ConfigField } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Callout } from '../shell-bits.tsx'

export function RestartSummary({ fields, draft }: { fields: ConfigField[]; draft: Record<string, string | null> }) {
  const { t } = useTranslation('settings')
  const needsRestart = fields.some((field) => field.restartRequired && field.key in draft)
  if (!needsRestart) return null
  return (
    <Callout tone="warn" className="mb-4">
      {t('restartPending')}
    </Callout>
  )
}
