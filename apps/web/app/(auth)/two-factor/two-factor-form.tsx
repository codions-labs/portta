'use client'

// The second factor: a TOTP code, or one of the backup codes printed when it
// was turned on. Both verify against the same session the password opened.

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'

export function TwoFactorForm() {
  const { t } = useTranslation('auth')
  const router = useRouter()
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: refused } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code })
    setBusy(false)
    if (refused) {
      setError(t('invalidCode'))
      return
    }
    router.push('/overview')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={backup ? t('backupCodeLabel') : t('code')} required>
        {(id) => (
          <Input
            id={id}
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            inputMode={backup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            mono
            maxLength={backup ? undefined : 6}
            placeholder={backup ? undefined : '000000'}
            className={backup ? undefined : 'h-14 text-center text-2xl tracking-[0.3em]'}
            required
            autoFocus
          />
        )}
      </Field>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/6 px-3 py-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="md" busy={busy} className="w-full">
        {busy ? t('verifying') : t('verify')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="w-full"
        onClick={() => {
          setBackup(!backup)
          setCode('')
        }}
      >
        {backup ? t('useAuthenticator') : t('backupCode')}
      </Button>
    </form>
  )
}
