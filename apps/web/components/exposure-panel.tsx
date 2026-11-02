'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, LockOpen, ShieldOff } from 'lucide-react'
import type { ContainerSummary } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { useCan } from '../lib/permissions.ts'
import { keys, useExposure } from '../lib/queries/index.ts'
import { Mono } from './copy.tsx'
import { Callout } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'

/**
 * Who may open this service's hostname: a credential, everybody, or nobody.
 *
 * The decision is a record in the ForwardAuth registry, so every button here
 * takes effect on the next request and recreates nothing.
 */
export function ExposurePanel({ container }: { container: ContainerSummary }) {
  const { t } = useTranslation('common', { keyPrefix: 'exposure' })
  const queryClient = useQueryClient()
  const mayDecide = useCan('service:protect')
  const [password, setPassword] = useState<string | null>(null)
  const hosts = [...new Set(container.urls.map((url) => url.host.toLowerCase()))]
  const host = hosts.length === 1 ? (hosts[0] ?? null) : null
  const query = useExposure()
  const entry = query.data?.entries.find((candidate) => candidate.host.toLowerCase() === host) ?? null
  const enforced = query.data?.enforced === true

  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.exposure() })
  const protect = useMutation({
    mutationFn: () => api.protectService(container.id),
    onSuccess: (result) => {
      setPassword(result.password ?? null)
      refresh()
    },
  })
  const open = useMutation({
    mutationFn: () => api.openService(container.id),
    onSuccess: () => {
      setPassword(null)
      refresh()
    },
  })
  const close = useMutation({
    mutationFn: () => api.closeService(container.id),
    onSuccess: () => {
      setPassword(null)
      refresh()
    },
  })
  const busy = protect.isPending || open.isPending || close.isPending
  const error = protect.error ?? open.error ?? close.error

  if (hosts.length > 1) return <p className="text-xs text-subtle">{t('severalHosts')}</p>
  if (!host) return null
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {entry?.mode === 'protected' ? (
          <Badge tone="ok">{t('protected')}</Badge>
        ) : entry?.mode === 'public' ? (
          <Badge tone="danger">{t('open')}</Badge>
        ) : enforced ? (
          <Badge tone="warn">{t('closed')}</Badge>
        ) : (
          <Badge>{t('unprotected')}</Badge>
        )}
        <Mono kind="text" tone="subtle">
          {host}
        </Mono>
        {entry?.user ? <span className="text-subtle">{t('user', { user: entry.user })}</span> : null}
      </div>
      <p className="text-subtle">{entry ? t('hintDecided') : enforced ? t('hintClosed') : t('hintUnprotected')}</p>
      {mayDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => protect.mutate()}>
            <Lock />
            {entry?.mode === 'protected' ? t('newPassword') : t('protect')}
          </Button>
          {entry?.mode !== 'public' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => open.mutate()}>
              <LockOpen />
              {t('makeOpen')}
            </Button>
          ) : null}
          {entry ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => close.mutate()}>
              <ShieldOff />
              {enforced ? t('close') : t('remove')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {password ? (
        <Callout
          tone="warn"
          title={
            <>
              {t('passwordLabel')}{' '}
              <Mono kind="text" tone="ink">
                {password}
              </Mono>
            </>
          }
        >
          {t('passwordHint')}
        </Callout>
      ) : null}
      {error ? <div className="text-danger">{error.message}</div> : null}
    </div>
  )
}
