// The second factor, reached only after a password was accepted.

import { redirect } from 'next/navigation'
import { serverTranslation } from '@/lib/i18n/server'
import { AuthCard } from '../auth-card'
import { authStatus } from '../status'
import { TwoFactorForm } from './two-factor-form'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPage() {
  const status = await authStatus()
  if (status.mode === 'open') redirect('/overview')

  const { t } = await serverTranslation('auth')
  return (
    <AuthCard title={t('twoFactorTitle')} description={t('twoFactorDescription')}>
      <TwoFactorForm />
    </AuthCard>
  )
}
