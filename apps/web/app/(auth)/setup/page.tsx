// Creating the owner: the one page a panel with no users will answer with.

import { redirect } from 'next/navigation'
import { serverTranslation } from '@/lib/i18n/server'
import { AuthCard } from '../auth-card'
import { authStatus } from '../status'
import { SetupForm } from './setup-form'

// The answer depends on a row in the database, so it is decided per request.
export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const status = await authStatus()
  // Nothing to set up: an open panel has no owner to create, and a panel that
  // already has one must not offer to create a second.
  if (status.mode === 'open' || !status.setupRequired) redirect('/overview')

  const { t } = await serverTranslation('auth')
  return (
    <AuthCard title={t('setupTitle')} description={t('setupDescription')}>
      <SetupForm />
    </AuthCard>
  )
}
