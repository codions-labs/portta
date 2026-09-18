'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ContainerSummary } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { ErrorBox } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/field.tsx'

export function ServiceAlias({ project, service }: { project: string; service: ContainerSummary }) {
  const { t } = useTranslation('environments', { keyPrefix: 'alias' })
  const { t: tc } = useTranslation('common')
  const name = service.service ?? service.name
  const queryClient = useQueryClient()
  const [value, setValue] = useState(service.overrides?.alias ?? '')

  const current = service.overrides?.alias ?? null

  const save = useMutation({
    mutationFn: () => api.serviceAlias(project, name, value.trim()),
    onSuccess: () => void queryClient.invalidateQueries(),
  })

  const clear = useMutation({
    mutationFn: () => api.clearServiceAlias(project, name),
    onSuccess: () => {
      setValue('')
      void queryClient.invalidateQueries()
    },
  })

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {service.urls.map((url) => (
          <Badge key={url.host} tone="outline">
            {url.host}
          </Badge>
        ))}
        {current ? <Badge tone="accent">{t('aliasBadge', { alias: current })}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('placeholder')}
          size="sm"
          className="w-56"
          aria-label={t('aliasFor', { name })}
        />
        <Button size="sm" disabled={save.isPending || value.trim() === ''} onClick={() => save.mutate()}>
          {current ? t('update') : t('add')}
        </Button>
        {current ? (
          <Button size="sm" disabled={clear.isPending} onClick={() => clear.mutate()}>
            {tc('remove')}
          </Button>
        ) : null}
      </div>

      {save.error ? <ErrorBox error={save.error} /> : null}
      {clear.error ? <ErrorBox error={clear.error} /> : null}

      <p className="text-2xs text-subtle">{t('hint')}</p>
    </div>
  )
}
