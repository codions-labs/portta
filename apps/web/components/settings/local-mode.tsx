'use client'

// What a section says when this panel has nobody to sign in.
//
// In `open` mode there are no accounts, no tokens, no second factor and nothing
// to audit. The rail does not offer these sections, so somebody only lands here
// from a bookmark or a link in a document — and the honest answer is that the
// feature is absent, not broken.

import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Empty } from '@/components/shell-bits'

export function LocalMode({ section }: { section: 'users' | 'tokens' | 'security' | 'audit' }) {
  const { t } = useTranslation('settings')
  return (
    <div className="rounded-lg border border-line bg-surface">
      <Empty icon={KeyRound} title={t('localMode.title')} hint={t(`localMode.${section}`)} />
    </div>
  )
}
