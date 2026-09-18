'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Environment } from 'portta-contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '../lib/api/index.ts'
import { useEnvironmentSettings } from '../lib/queries/index.ts'
import { ErrorBox } from './shell-bits.tsx'
import { Button } from './ui/button.tsx'
import { Checkbox, Field, Input, Select } from './ui/field.tsx'
import { Switch } from './ui/switch.tsx'

/** The overrides form: what the environment settings page shows. */
export function EnvironmentSettingsForm({
  project,
  enabled = true,
  onDone,
}: {
  project: Environment
  enabled?: boolean
  onDone?: () => void
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'overrides' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const query = useEnvironmentSettings(project.name, enabled)

  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryService, setPrimaryService] = useState('')
  const [hidden, setHidden] = useState<string[]>([])
  const [pinned, setPinned] = useState(false)
  const [archived, setArchived] = useState(false)

  useEffect(() => {
    if (!query.data) return
    setDisplayName(query.data.displayName ?? '')
    setDescription(query.data.description ?? '')
    setPrimaryService(query.data.primaryService ?? '')
    setHidden(query.data.hiddenServices ?? [])
    setPinned(query.data.pinned ?? false)
    setArchived(query.data.archived ?? false)
  }, [query.data])

  const save = useMutation({
    mutationFn: () =>
      api.setEnvironmentSettings(project.name, {
        displayName: displayName.trim() === '' ? null : displayName.trim(),
        description: description.trim() === '' ? null : description.trim(),
        primaryService: primaryService === '' ? null : primaryService,
        hiddenServices: hidden.length === 0 ? null : hidden,
        pinned: pinned ? true : null,
        archived: archived ? true : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onDone?.()
    },
  })

  const reset = useMutation({
    mutationFn: () => api.clearEnvironmentSettings(project.name),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onDone?.()
    },
  })

  const names = project.services.map((service) => service.service ?? service.name)
  const unavailable = query.error instanceof ApiError && query.error.status === 503

  const footer = (
    <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
      <Button size="sm" disabled={reset.isPending || unavailable} onClick={() => reset.mutate()}>
        {t('reset')}
      </Button>
      <Button size="sm" variant="primary" disabled={save.isPending || unavailable} onClick={() => save.mutate()}>
        {tc('save')}
      </Button>
    </div>
  )

  return (
    <div>
      {query.error ? <ErrorBox error={query.error} /> : null}

      <div className="space-y-3">
        <Field label={t('displayName')} hint={t('derivedNameHint', { name: project.name })}>
          {(id) => (
            <Input
              id={id}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={project.name}
              aria-label={t('displayName')}
            />
          )}
        </Field>

        <Field label={t('descriptionLabel')}>
          {(id) => (
            <Input
              id={id}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label={t('descriptionLabel')}
            />
          )}
        </Field>

        <Field label={t('primaryService')}>
          {(id) => (
            <Select
              id={id}
              value={primaryService}
              onChange={(event) => setPrimaryService(event.target.value)}
              aria-label={t('primaryService')}
              className="w-full"
            >
              <option value="">{t('none')}</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted">{t('collapsedServices')}</legend>
          <p className="text-2xs text-subtle">{t('collapsedServicesHint')}</p>
          {names.map((name) => (
            <label key={name} className="flex h-7 items-center gap-2 text-sm">
              <Checkbox
                checked={hidden.includes(name)}
                onChange={(event) =>
                  setHidden((current) =>
                    event.target.checked ? [...current, name] : current.filter((entry) => entry !== name),
                  )
                }
              />
              {name}
            </label>
          ))}
        </fieldset>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t('pinned')}</span>
          <Switch checked={pinned} onCheckedChange={setPinned} aria-label={t('pinned')} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t('archived')}</span>
          <Switch checked={archived} onCheckedChange={setArchived} aria-label={t('archived')} />
        </div>
      </div>
      {footer}
    </div>
  )
}
