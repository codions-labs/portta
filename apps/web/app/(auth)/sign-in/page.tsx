// Signing in.

import { Boxes, ShieldCheck, Terminal } from 'lucide-react'
import { redirect } from 'next/navigation'
import { serverTranslation } from '@/lib/i18n/server'
import { AuthCard, AuthSplit, Brand } from '../auth-card'
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
    <AuthSplit
      hero={
        <>
          <Brand />
          <p className="max-w-115 font-heading text-4xl leading-[1.15] font-semibold tracking-tight text-ink">
            {t('heroTitle')}
          </p>
          <p className="max-w-115 text-base text-subtle">{t('heroLead')}</p>
          <div className="grid max-w-125 grid-cols-[repeat(auto-fit,minmax(8.125rem,1fr))] gap-3">
            {[
              { icon: Boxes, key: 'projects' },
              { icon: ShieldCheck, key: 'access' },
              { icon: Terminal, key: 'agents' },
            ].map(({ icon: Icon, key }) => (
              <div key={key} className="min-w-0 rounded-xl border border-line bg-surface p-3">
                <Icon aria-hidden className="size-4 text-link" />
                <b className="mt-2 block text-sm font-semibold text-ink">{t(`pillars.${key}.title`)}</b>
                <small className="block text-xs leading-snug text-subtle">{t(`pillars.${key}.help`)}</small>
              </div>
            ))}
          </div>
        </>
      }
    >
      <AuthCard title={t('signInTitle')} description={t('signInDescription')}>
        <SignInForm />
      </AuthCard>
    </AuthSplit>
  )
}
