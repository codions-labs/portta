'use client'

// Your own account: who you are, your password, your second factor, and the
// browsers you are signed in on.
//
// This is the one place in the panel that calls Better Auth's client directly.
// Everything about other people goes through Portta's API, because the rules
// there are Portta's — but a person acting on their own credentials is exactly
// what the library's endpoints are, and reimplementing them would mean
// reimplementing the session handling with them.

import { KeyRound, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MySessionsCard } from '@/components/settings/my-sessions-card'
import { PasswordDialog } from '@/components/settings/password-dialog'
import { TwoFactorCard } from '@/components/settings/two-factor-card'
import { KeyValue, PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { usePrincipal } from '@/lib/principal'

export function SecurityView() {
  const { t } = useTranslation('settings')
  const { t: ta } = useTranslation('auth')
  const principal = usePrincipal()
  const [changing, setChanging] = useState(false)

  return (
    <>
      <PageHeader title={t('security.title')} description={t('security.description')} />

      <div className="grid gap-4">
        <Card>
          <CardHeader title={t('security.profile')} icon={<UserRound />} />
          <CardBody>
            <dl className="grid gap-1 sm:grid-cols-3">
              <KeyValue label={t('users.name')}>{principal.name}</KeyValue>
              <KeyValue label={t('users.email')}>{principal.email ?? '—'}</KeyValue>
              <KeyValue label={t('users.role')}>
                <Badge tone="accent">{ta(`role.${principal.role}`)}</Badge>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('security.password')}
            description={t('security.passwordDescription')}
            icon={<KeyRound />}
            actions={
              <Button size="sm" onClick={() => setChanging(true)}>
                {t('security.changePassword')}
              </Button>
            }
          />
        </Card>

        <TwoFactorCard />

        <MySessionsCard />
      </div>

      <PasswordDialog
        open={changing}
        onOpenChange={setChanging}
        title={t('security.changePassword')}
        description={t('security.changePasswordDescription')}
        askCurrent
        onSubmit={async (password, current) => {
          const { error } = await authClient.changePassword({
            newPassword: password,
            currentPassword: current,
            // Somebody changing a password because it may be known elsewhere
            // expects the other browsers to be signed out. This is that.
            revokeOtherSessions: true,
          })
          if (error) throw new Error(error.message ?? t('security.passwordRefused'))
        }}
      />
    </>
  )
}
