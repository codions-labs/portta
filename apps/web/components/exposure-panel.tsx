'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, LockOpen, ShieldOff } from 'lucide-react'
import type { ContainerSummary } from 'portta-contracts'
import { hasForwardAuth } from 'portta-core/browser'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { useCan } from '../lib/permissions.ts'
import { keys, useExposure } from '../lib/queries/index.ts'
import { cn } from '../lib/utils.ts'
import { CopyButton, Mono } from './copy.tsx'
import { Callout } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'

/** The same canonical form the server keys its registry by: lowercase, punycode, no trailing dot or default port. */
export function canonicalHost(host: string): string {
  try {
    const parsed = new URL(`http://${host.trim()}`)
    return `${parsed.hostname.replace(/\.$/, '')}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return host.trim().toLowerCase()
  }
}

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
  const hosts = [...new Set(container.urls.map((url) => canonicalHost(url.host)))]
  const host = hosts.length === 1 ? (hosts[0] ?? null) : null
  const query = useExposure()
  const entry = query.data?.entries.find((candidate) => canonicalHost(candidate.host) === host) ?? null
  const enforced = hasForwardAuth(container.labels)

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

  if (hosts.length > 1) return <p className="text-sm text-subtle">{t('severalHosts')}</p>
  if (!host) return null

  const passwordNotice =
    enforced && password ? (
      <Callout
        tone="warn"
        title={
          <>
            {t('passwordLabel')}{' '}
            <Mono kind="text" tone="ink">
              {password}
            </Mono>
            <CopyButton value={password} label={t('passwordLabel')} className="ml-1 align-middle" />
          </>
        }
      >
        {t('passwordHint')}
      </Callout>
    ) : null
  const failure = error ? <div className="text-sm text-danger">{error.message}</div> : null

  // Where nothing asks for a login there is no decision to take, only one to undo.
  if (!enforced || !mayDecide) {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {!enforced ? (
            <Badge>{t('unprotected')}</Badge>
          ) : entry?.mode === 'protected' ? (
            <Badge tone="ok">{t('protected')}</Badge>
          ) : entry?.mode === 'public' ? (
            <Badge tone="info">{t('open')}</Badge>
          ) : (
            <Badge tone="warn">{t('closed')}</Badge>
          )}
          <Mono kind="text" tone="subtle">
            {host}
          </Mono>
          {enforced && entry?.user ? <span className="text-subtle">{t('user', { user: entry.user })}</span> : null}
        </div>
        <p className="text-subtle">{!enforced ? t('hintUnprotected') : entry ? t('hintDecided') : t('hintClosed')}</p>
        {mayDecide ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled>
              <Lock />
              {entry?.mode === 'protected' ? t('newPassword') : t('protect')}
            </Button>
            {entry ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => close.mutate()}>
                <ShieldOff />
                {t('remove')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {failure}
      </div>
    )
  }

  const choices = [
    {
      id: 'protected',
      title: t('who.protected'),
      detail: t('who.protectedDetail'),
      icon: Lock,
      run: () => protect.mutate(),
    },
    { id: 'public', title: t('who.public'), detail: t('who.publicDetail'), icon: LockOpen, run: () => open.mutate() },
    { id: 'closed', title: t('who.closed'), detail: t('who.closedDetail'), icon: ShieldOff, run: () => close.mutate() },
  ]
  // Nothing is chosen until the registry answered: showing Nobody meanwhile would be a claim.
  const current = query.data ? (entry?.mode ?? 'closed') : null

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-subtle">{t('hintDecided')}</p>
      <div role="radiogroup" aria-label={t('who.label')} className="space-y-2">
        {choices.map((choice) => {
          const selected = current === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={busy || current === null}
              onClick={() => {
                if (!selected) choice.run()
              }}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border bg-surface px-3.5 py-3 text-left transition-colors duration-100 focus-ring disabled:opacity-70',
                selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:bg-surface-2',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0 rounded-full',
                  selected ? 'border-[5px] border-accent' : 'border-2 border-line-strong',
                )}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{choice.title}</span>
                <span className="block text-xs text-subtle">{choice.detail}</span>
              </span>
            </button>
          )
        })}
      </div>
      {entry?.mode === 'protected' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {entry.user ? <span className="text-subtle">{t('user', { user: entry.user })}</span> : <span />}
          <Button size="sm" disabled={busy} onClick={() => protect.mutate()}>
            {t('newPassword')}
          </Button>
        </div>
      ) : null}
      {passwordNotice}
      {failure}
    </div>
  )
}
