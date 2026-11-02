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
import { PasswordInput } from '@/components/ui/password-input'
import { signIn } from '@/lib/auth-client'

const MIN_PASSWORD = 10

/** How far the password is from long enough, which is the only rule there is. */
function PasswordLength({ length }: { length: number }) {
  const { t } = useTranslation('auth')
  return (
    <>
      <span aria-hidden className="mb-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full bg-link transition-[width] duration-150"
          style={{ width: `${Math.min(100, (length / MIN_PASSWORD) * 100)}%` }}
        />
      </span>
      {length >= MIN_PASSWORD ? t('passwordLongEnough') : t('passwordRemaining', { count: MIN_PASSWORD - length })}
    </>
  )
}

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
      <Field label={t('password')} hint={<PasswordLength length={password.length} />} required>
        {(id) => (
          <PasswordInput
            id={id}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
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
        {busy ? t('creating') : t('create')}
      </Button>
    </form>
  )
}
