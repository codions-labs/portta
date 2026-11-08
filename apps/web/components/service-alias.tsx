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

type Dns = { type: 'A' | 'CNAME'; name: string; value: string | null }

/** Every additional address of the service, whichever version of the setting stored it. */
export function additionalHosts(service: ContainerSummary): string[] {
  const stored = service.overrides?.aliases
  if (stored && stored.length > 0) return stored
  return service.overrides?.alias ? [service.overrides.alias] : []
}

export function ServiceAlias({ project, service }: { project: string; service: ContainerSummary }) {
  const { t } = useTranslation('environments', { keyPrefix: 'alias' })
  const name = service.service ?? service.name
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [dns, setDns] = useState<Dns | null>(null)

  const hosts = additionalHosts(service)
  const custom = new Set(service.urls.filter((url) => url.custom).map((url) => url.host))
  const derived = service.urls.filter((url) => !url.alias)

  const save = useMutation({
    mutationFn: () => api.serviceAlias(project, name, value.trim()),
    onSuccess: (result) => {
      setValue('')
      setDns(result.dns)
      void queryClient.invalidateQueries()
    },
  })

  const clear = useMutation({
    mutationFn: (host: string) => api.clearServiceAlias(project, name, host),
    onSuccess: () => {
      setDns(null)
      void queryClient.invalidateQueries()
    },
  })

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {derived.map((url) => (
          <Badge key={url.host} tone="outline">
            {url.host}
          </Badge>
        ))}
        {hosts.map((host) => (
          <span key={host} className="inline-flex items-center gap-1">
            <Badge tone="accent">
              {host}
              {custom.has(host) ? ` · ${t('custom')}` : ''}
            </Badge>
            <Button
              size="sm"
              disabled={clear.isPending}
              aria-label={t('remove', { host })}
              onClick={() => clear.mutate(host)}
            >
              ×
            </Button>
          </span>
        ))}
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim() !== '') save.mutate()
        }}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('placeholder')}
          size="sm"
          className="w-64"
          aria-label={t('aliasFor', { name })}
        />
        <Button size="sm" type="submit" disabled={save.isPending || value.trim() === ''}>
          {t('add')}
        </Button>
      </form>

      {dns ? (
        <div className="rounded-md border border-border p-2 text-2xs" role="status">
          <p className="font-medium">{t('dnsTitle')}</p>
          <p className="font-mono">
            {dns.value
              ? t('dnsRecord', { type: dns.type, name: dns.name, value: dns.value })
              : t('dnsUnknown', { name: dns.name })}
          </p>
          <p className="text-subtle">{t('dnsCertificate')}</p>
        </div>
      ) : null}

      {save.error ? <ErrorBox error={save.error} /> : null}
      {clear.error ? <ErrorBox error={clear.error} /> : null}

      <p className="text-2xs text-subtle">{t('hint')}</p>
    </div>
  )
}
