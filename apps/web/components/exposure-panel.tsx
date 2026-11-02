'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, ShieldOff } from 'lucide-react'
import type { ContainerSummary } from 'portta-contracts'
import { hasForwardAuth } from 'portta-core/browser'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { canonicalHost } from '../lib/host-access.ts'
import { useCan } from '../lib/permissions.ts'
import { keys, useExposure } from '../lib/queries/index.ts'
import { cn } from '../lib/utils.ts'
import { CopyButton, Mono } from './copy.tsx'
import { Callout } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { ConfirmDialog } from './ui/confirm-dialog.tsx'
import { Segmented } from './ui/segmented.tsx'

/** Deciding who may open one service's hostname, wherever the decision is offered. */
export function useExposureDecision(container: ContainerSummary) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState<string | null>(null)
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
  return {
    protect,
    open,
    close,
    password,
    busy: protect.isPending || open.isPending || close.isPending,
    error: protect.error ?? open.error ?? close.error,
  }
}

export type ExposureDecision = ReturnType<typeof useExposureDecision>
type Choice = 'protected' | 'public' | 'closed'

/**
 * The three answers, as cards where there is room to explain them and as one
 * line where a row has to fit. Opening a site to everybody is the one that asks
 * first: it is a single click away from the other two, and it is the one that
 * cannot be taken back from whoever already saw it.
 */
export function ExposureChoice({
  current,
  decision,
  host,
  compact = false,
}: {
  /** Null until the registry answered: showing Nobody meanwhile would be a claim. */
  current: Choice | null
  decision: ExposureDecision
  host: string
  compact?: boolean
}) {
  const { t } = useTranslation('common', { keyPrefix: 'exposure' })
  const [confirm, setConfirm] = useState(false)
  const choose = (next: Choice) => {
    if (next === current) return
    if (next === 'public') setConfirm(true)
    else if (next === 'protected') decision.protect.mutate()
    else decision.close.mutate()
  }
  const dialog = (
    <ConfirmDialog
      open={confirm}
      onOpenChange={setConfirm}
      title={t('confirmOpen.title', { host })}
      impact={t('confirmOpen.impact')}
      confirmLabel={t('confirmOpen.confirm')}
      busy={decision.open.isPending}
      onConfirm={() => {
        decision.open.mutate()
        setConfirm(false)
      }}
    />
  )

  if (compact) {
    return (
      <>
        <Segmented
          label={t('who.label')}
          value={current ?? 'closed'}
          onChange={choose}
          className={decision.busy ? 'pointer-events-none opacity-70' : undefined}
          options={[
            { value: 'protected', label: t('short.protected'), selectedClassName: 'text-ok' },
            { value: 'public', label: t('short.public'), selectedClassName: 'text-info' },
            { value: 'closed', label: t('short.closed'), selectedClassName: 'text-warn' },
          ]}
        />
        {dialog}
      </>
    )
  }

  const choices: { id: Choice; title: string; detail: string }[] = [
    { id: 'protected', title: t('who.protected'), detail: t('who.protectedDetail') },
    { id: 'public', title: t('who.public'), detail: t('who.publicDetail') },
    { id: 'closed', title: t('who.closed'), detail: t('who.closedDetail') },
  ]
  return (
    <>
      <div role="radiogroup" aria-label={t('who.label')} className="space-y-2">
        {choices.map((choice) => {
          const selected = current === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={decision.busy || current === null}
              onClick={() => choose(choice.id)}
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
      {dialog}
    </>
  )
}

/**
 * Who may open this service's hostname: a credential, everybody, or nobody.
 *
 * The decision is a record in the ForwardAuth registry, so every button here
 * takes effect on the next request and recreates nothing.
 */
export function ExposurePanel({ container }: { container: ContainerSummary }) {
  const { t } = useTranslation('common', { keyPrefix: 'exposure' })
  const mayDecide = useCan('service:protect')
  const hosts = [...new Set(container.urls.map((url) => canonicalHost(url.host)))]
  const host = hosts.length === 1 ? (hosts[0] ?? null) : null
  const query = useExposure()
  const entry = query.data?.entries.find((candidate) => canonicalHost(candidate.host) === host) ?? null
  const enforced = hasForwardAuth(container.labels)
  const decision = useExposureDecision(container)
  const { protect, close, busy, error, password } = decision

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

  // Nothing is chosen until the registry answered: showing Nobody meanwhile would be a claim.
  const current = query.data ? (entry?.mode ?? 'closed') : null

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-subtle">{t('hintDecided')}</p>
      <ExposureChoice current={current} decision={decision} host={host} />
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
