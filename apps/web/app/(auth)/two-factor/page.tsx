// The second factor, reached only after a password was accepted.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { serverTranslation } from '@/lib/i18n/server'
import { AuthCard, AuthSingle } from '../auth-card'
import { authStatus } from '../status'
import { TwoFactorForm } from './two-factor-form'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPage() {
  const status = await authStatus()
  if (status.mode === 'open') redirect('/overview')

  const { t } = await serverTranslation('auth')
  return (
    <AuthSingle
      footer={
        <Link
          href="/sign-in"
          className="text-center text-sm font-medium text-link underline-offset-2 hover:underline focus-ring"
        >
          {t('otherAccount')}
        </Link>
      }
    >
      <AuthCard title={t('twoFactorTitle')} description={t('twoFactorDescription')}>
        <TwoFactorForm />
      </AuthCard>
    </AuthSingle>
  )
}
