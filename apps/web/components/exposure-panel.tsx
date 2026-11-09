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
import { keys, useExposure, useGateway } from '../lib/queries/index.ts'
import { cn } from '../lib/utils.ts'
import { CopyButton, Mono } from './copy.tsx'
import { Callout } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { ConfirmDialog } from './ui/confirm-dialog.tsx'
import { Checkbox } from './ui/field.tsx'
import { Segmented } from './ui/segmented.tsx'

/** Deciding who may open one service's hostname, wherever the decision is offered. */
export function useExposureDecision(container: ContainerSummary, host?: string) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState<string | null>(null)
  // Asked before choosing, since choosing is what makes the password.
  const [passwordOnly, setPasswordOnly] = useState(false)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.exposure() })
  const protect = useMutation({
    mutationFn: () =>
      api.protectService(container.id, { ...(passwordOnly ? { user: null } : {}), ...(host ? { host } : {}) }),
    onSuccess: (result) => {
      setPassword(result.password ?? null)
      refresh()
    },
  })
  const open = useMutation({
    mutationFn: () => (host ? api.openService(container.id, host) : api.openService(container.id)),
    onSuccess: () => {
      setPassword(null)
      refresh()
    },
  })
  const close = useMutation({
    mutationFn: () => (host ? api.closeService(container.id, host) : api.closeService(container.id)),
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
    passwordOnly,
    setPasswordOnly,
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
      {current !== 'protected' ? (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-muted">
          <Checkbox
            checked={decision.passwordOnly}
            disabled={decision.busy}
            onChange={(event) => decision.setPasswordOnly(event.target.checked)}
          />
          {t('who.passwordOnly')}
        </label>
      ) : null}
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
  const hosts = [...new Set(container.urls.map((url) => canonicalHost(url.host)))]
  if (hosts.length === 0) return null
  return (
    <div className="space-y-4">
      {hosts.map((host) => (
        <div key={host} role="group" aria-label={host} className="space-y-2">
          {hosts.length > 1 ? (
            <Mono kind="text" tone="ink">
              {host}
            </Mono>
          ) : null}
          <HostExposurePanel
            container={container}
            host={host}
            explicitHost={hosts.length > 1 || container.urls.some((url) => url.host === host && url.alias)}
          />
        </div>
      ))}
    </div>
  )
}

function HostExposurePanel({
  container,
  host,
  explicitHost,
}: {
  container: ContainerSummary
  host: string
  explicitHost: boolean
}) {
  const { t } = useTranslation('common', { keyPrefix: 'exposure' })
  const permission = useCan('service:protect')
  const gateway = useGateway(permission)
  const mayDecide = permission && gateway.data?.panel.readOnly === false
  const query = useExposure()
  const entry = query.data?.entries.find((candidate) => canonicalHost(candidate.host) === host) ?? null
  const route = container.urls.find((url) => canonicalHost(url.host) === host)
  const enforced = route?.forwardAuth ?? hasForwardAuth(container.labels)
  const decision = useExposureDecision(container, explicitHost ? host : undefined)
  const { protect, close, busy, error, password } = decision

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
