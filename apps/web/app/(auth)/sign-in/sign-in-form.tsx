'use client'

// Signing in, through Better Auth's own client so the cookie, the rate limit
// and the two-factor redirect are the library's.

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { signIn } from '@/lib/auth-client'

export function SignInForm() {
  const { t } = useTranslation('auth')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: refused } = await signIn.email({ email, password })
    setBusy(false)
    if (refused) {
      // Deliberately the same sentence whichever half was wrong: telling
      // somebody the email exists is telling them which one to keep guessing.
      setError(t('invalidCredentials'))
      return
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      router.push('/two-factor')
      return
    }
    router.push('/overview')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t('email')} required>
        {(id) => (
          <Input
            id={id}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        )}
      </Field>
      <Field label={t('password')} required>
        {(id) => (
          <Input
            id={id}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="md" busy={busy} className="w-full">
        {busy ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  )
}
