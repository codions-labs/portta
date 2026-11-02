// Creating the owner: the one page a panel with no users will answer with.

import { redirect } from 'next/navigation'
import { serverTranslation } from '@/lib/i18n/server'
import { AuthCard, AuthSplit, Brand } from '../auth-card'
import { authStatus } from '../status'
import { CommandLine } from './command-line'
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
    <AuthSplit
      hero={
        <>
          <Brand />
          <p className="max-w-115 font-heading text-4xl leading-[1.15] font-semibold tracking-tight text-ink">
            {t('setupHeroTitle')}
          </p>
          <p className="max-w-115 text-base text-subtle">{t('setupHeroLead')}</p>
          <div className="grid max-w-115 min-w-0 gap-1.5">
            <p className="text-sm font-semibold text-ink">{t('setupTerminal')}</p>
            <CommandLine value="portta auth bootstrap --name 'Ada' --email ada@empresa.com --password-stdin" />
          </div>
        </>
      }
    >
      <AuthCard title={t('setupTitle')}>
        <SetupForm />
      </AuthCard>
    </AuthSplit>
  )
}
