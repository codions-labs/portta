'use client'

// Creating a token, and the one moment its secret exists in a browser.
//
// The panel never stores the secret and cannot show it again: what it keeps is
// a hash and the first characters. So the dialog does not close on its own —
// it asks the person to say they copied it, which is the only acknowledgement
// that a lost secret means making another token.

import { useMutation } from '@tanstack/react-query'
import { Bot, User as UserIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Pre } from '@/components/copy'
import { Callout, ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { api } from '@/lib/api'

/** Never "forever": a credential with no end is one nobody remembers to end. */
const LIFETIMES = ['30', '90', '365'] as const

export function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [name, setName] = useState('')
  const [actorKind, setActorKind] = useState<'human' | 'agent'>('agent')
  const [days, setDays] = useState<string>('90')
  const [secret, setSecret] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.createApiToken({ name, actorKind, expiresInDays: Number(days) }),
    onSuccess: (created) => {
      setSecret(created.token)
      onCreated()
    },
  })

  const close = () => {
    setName('')
    setActorKind('agent')
    setDays('90')
    setSecret(null)
    create.reset()
    onOpenChange(false)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() !== '') create.mutate()
  }

  if (secret) {
    return (
      <Dialog
        open={open}
        // The secret is on screen and nowhere else. Closing by accident — a
        // stray escape, a click outside — would lose it for good.
        dismissible={false}
        onOpenChange={() => undefined}
        title={t('tokens.createdTitle')}
        description={t('tokens.createdDescription')}
        footer={
          <>
            <CopyButton value={secret} label={t('tokens.copySecret')} />
            <Button variant="primary" size="sm" onClick={close}>
              {t('tokens.copied')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Callout tone="warn">{t('tokens.onlyOnce')}</Callout>
          <Pre>{secret}</Pre>
          <p className="text-xs text-subtle">{t('tokens.useHint')}</p>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('tokens.create')}
      description={t('tokens.createDescription')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            form="create-token"
            type="submit"
            disabled={create.isPending || name.trim() === ''}
          >
            {create.isPending ? tc('saving') : t('tokens.create')}
          </Button>
        </>
      }
    >
      <form id="create-token" onSubmit={submit} className="grid gap-3">
        {create.error ? <ErrorBox error={create.error} /> : null}
        <Field label={t('tokens.name')} hint={t('tokens.nameHint')} required>
          {(id) => (
            <Input id={id} value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="off" />
          )}
        </Field>
        <Field label={t('tokens.actorKind')} hint={t(`tokens.actorHint.${actorKind}`)}>
          <Segmented
            label={t('tokens.actorKind')}
            value={actorKind}
            onChange={setActorKind}
            options={[
              { value: 'agent', label: t('tokens.agent'), icon: Bot },
              { value: 'human', label: t('tokens.human'), icon: UserIcon },
            ]}
          />
        </Field>
        <Field label={t('tokens.expires')} hint={t('tokens.expiresHint')}>
          {(id) => (
            <Select id={id} value={days} onChange={(event) => setDays(event.currentTarget.value)}>
              {LIFETIMES.map((option) => (
                <option key={option} value={option}>
                  {t('tokens.days', { count: Number(option) })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-xs text-subtle">{t('tokens.scopeNote')}</p>
      </form>
    </Dialog>
  )
}
