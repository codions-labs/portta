// Signing in.

import { redirect } from 'next/navigation'
import { serverTranslation } from '@/lib/i18n/server'
import { AuthCard } from '../auth-card'
import { authStatus } from '../status'
import { SignInForm } from './sign-in-form'

export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  const status = await authStatus()
  if (status.mode === 'open') redirect('/overview')
  // There is nobody to sign in as yet, and saying so is more useful than a form
  // that can only fail.
  if (status.setupRequired) redirect('/setup')

  const { t } = await serverTranslation('auth')
  return (
    <AuthCard title={t('signInTitle')} description={t('signInDescription')}>
      <SignInForm />
    </AuthCard>
  )
}
