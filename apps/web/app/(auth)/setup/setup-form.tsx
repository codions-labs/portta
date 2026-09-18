'use client'

// Creating the owner.
//
// Portta's own endpoint rather than Better Auth's sign-up, which is disabled:
// the first account is created under an advisory lock, so two people opening
// this page at the same moment produce one owner and one clear refusal.

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { signIn } from '@/lib/auth-client'

export function SetupForm() {
  const { t } = useTranslation('auth')
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      if (response.status === 409) {
        setError(t('setupClosed'))
        return
      }
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? t('invalidCredentials'))
        return
      }
      // The account exists and the password is the one just typed, so the
      // person is signed in here rather than sent to a form to retype it.
      const { error: refused } = await signIn.email({ email, password })
      if (refused) {
        router.push('/sign-in')
        return
      }
      router.push('/overview')
      router.refresh()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t('name')} required>
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            autoFocus
          />
        )}
      </Field>
      <Field label={t('email')} required>
        {(id) => (
          <Input
            id={id}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        )}
      </Field>
      <Field label={t('password')} hint={t('passwordHint')} required>
        {(id) => (
          <Input
            id={id}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
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
        {busy ? t('creating') : t('create')}
      </Button>
    </form>
  )
}
