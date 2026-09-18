'use client'

// Setting a password: an administrator's reset, or your own change.
//
// The same dialog for both, because the difference is one field and the rules
// about what a password may be are the same either way. The caller supplies
// what to do with it; this only asks twice and reports what came back.

import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Callout, ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'

export function PasswordDialog({
  open,
  onOpenChange,
  title,
  description,
  /** Asked for when the person is changing their own password. */
  askCurrent = false,
  onSubmit,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  askCurrent?: boolean
  onSubmit: (password: string, current: string) => Promise<unknown>
  onDone?: () => void
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')

  const save = useMutation({
    mutationFn: () => onSubmit(password, current),
    onSuccess: () => {
      setCurrent('')
      setPassword('')
      setRepeat('')
      onOpenChange(false)
      onDone?.()
    },
  })

  const mismatch = repeat !== '' && repeat !== password
  const ready = password.length >= 10 && !mismatch && (!askCurrent || current.length > 0)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready) save.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" size="sm" form="set-password" type="submit" disabled={!ready || save.isPending}>
            {save.isPending ? tc('saving') : tc('save')}
          </Button>
        </>
      }
    >
      <form id="set-password" onSubmit={submit} className="grid gap-3">
        {save.error ? <ErrorBox error={save.error} /> : null}
        <Callout tone="warn">{t('users.passwordSignsOut')}</Callout>
        {askCurrent ? (
          <Field label={t('security.currentPassword')} required>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.currentTarget.value)}
              />
            )}
          </Field>
        ) : null}
        <Field label={t('users.password')} hint={t('users.passwordHint')} required>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={t('users.repeatPassword')} error={mismatch ? t('users.passwordMismatch') : undefined} required>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.currentTarget.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
