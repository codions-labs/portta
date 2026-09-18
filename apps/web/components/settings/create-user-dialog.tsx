'use client'

// A new account, made by somebody who is already signed in.
//
// There is no invitation and no self sign-up: `POST /api/auth/sign-up/email` is
// closed once the panel has an owner, so an account exists because an
// administrator created it and handed over the first password.

import { useMutation } from '@tanstack/react-query'
import type { ProjectSummary, Role } from 'portta-contracts'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { api } from '@/lib/api'
import { ProjectPicker } from './project-picker'

const ROLES: Role[] = ['admin', 'developer', 'viewer']

export function CreateUserDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectSummary[]
  onCreated: () => void
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { t: ta } = useTranslation('auth')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [scope, setScope] = useState<number[]>([])

  const create = useMutation({
    mutationFn: () =>
      api.createUser({
        name,
        email,
        password,
        role,
        ...(role === 'owner' || role === 'admin' ? {} : { projects: scope }),
      }),
    onSuccess: () => {
      setName('')
      setEmail('')
      setPassword('')
      setRole('viewer')
      setScope([])
      onOpenChange(false)
      onCreated()
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate()
  }

  const scoped = role !== 'admin'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.create')}
      description={t('users.createDescription')}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            form="create-user"
            type="submit"
            disabled={create.isPending || name.trim() === '' || email.trim() === '' || password.length < 10}
          >
            {create.isPending ? tc('saving') : t('users.create')}
          </Button>
        </>
      }
    >
      <form id="create-user" onSubmit={submit} className="grid gap-3">
        {create.error ? <ErrorBox error={create.error} /> : null}
        <Field label={t('users.name')} required>
          {(id) => (
            <Input id={id} value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="off" />
          )}
        </Field>
        <Field label={t('users.email')} required>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t('users.password')} hint={t('users.passwordHint')} required>
          {(id) => (
            <Input
              id={id}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label={t('users.role')} hint={t(`roleHints.${role}`)}>
          {(id) => (
            <Select id={id} value={role} onChange={(event) => setRole(event.currentTarget.value as Role)}>
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {ta(`role.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {scoped ? (
          <Field label={t('users.projectAccess')} hint={t('users.projectAccessHint')}>
            <ProjectPicker projects={projects} selected={scope} onChange={setScope} />
          </Field>
        ) : null}
      </form>
    </Dialog>
  )
}
