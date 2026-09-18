'use client'

// What to call the place the work lives, in a sentence.
//
// The panel says "opened on GitHub" rather than "opened on the provider"
// wherever it knows which one it is, because the operator fixes GitHub, not an
// abstraction — and falls back to the generic word only when the Project has
// not resolved one yet.

import type { TaskProvider } from 'portta-contracts'
import { useTranslation } from 'react-i18next'

export function useProviderName(): (provider: TaskProvider | null) => string {
  const { t } = useTranslation('issues')
  return (provider) =>
    provider === 'github' ? t('provider.github') : provider === 'linear' ? t('provider.linear') : t('provider.unknown')
}
