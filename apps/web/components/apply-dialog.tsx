'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, Loader2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api/index.ts'
import { keys } from '../lib/queries/keys.ts'
import { type ApplyMachine, mmss } from '../lib/use-apply.ts'
import { CommandRow, Mono, Pre } from './copy.tsx'
import { PendingDiff } from './pending-diff.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { useToast } from './ui/toast.tsx'

function Step({ done, active, label }: { done: boolean; active?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
      ) : active ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
      ) : (
        <Circle className="size-3.5 shrink-0 text-subtle" />
      )}
      <span className={done ? 'text-ink' : 'text-muted'}>{label}</span>
    </li>
  )
}

function Command({ value }: { value: string }) {
  return <CommandRow command={value} className="mt-3" />
}

export function ApplyDialog({ machine, readOnly = false }: { machine: ApplyMachine; readOnly?: boolean }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'apply' })
  const { t: tc } = useTranslation('common')
  const { phase, busy, status, elapsedSeconds, sawOffline } = machine
  const command = status?.applyCommand ?? './bin/portta up'
  const queryClient = useQueryClient()
  const toast = useToast()

  const discard = useMutation({
    mutationFn: (keysToDrop?: string[]) => api.discardConfig(keysToDrop),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: keys.config() })
      void queryClient.invalidateQueries({ queryKey: keys.apply() })
      toast.push({
        tone: 'ok',
        title: t('discarded', { count: result.discarded.length }),
      })
      if (!result.pendingRestart) machine.dismiss()
    },
    onError: (cause) => {
      toast.push({
        tone: 'danger',
        title: cause instanceof Error ? cause.message : String(cause),
      })
    },
  })

  if (phase === 'confirming') {
    const changes = status?.pendingChanges ?? []
    const needsRecreate = changes.some((change) => change.restartRequired) || changes.length === 0
    const canDiscard = !readOnly && changes.length > 0 && !discard.isPending

    return (
      <Dialog
        open
        size="md"
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('confirmTitle')}
        description={needsRecreate ? t('confirmDescription') : t('confirmReference')}
        footer={
          <>
            {canDiscard ? (
              <Button variant="ghost" className="mr-auto" onClick={() => discard.mutate(undefined)}>
                {t('discardAll')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={machine.dismiss}>
              {tc('cancel')}
            </Button>
            {needsRecreate && !readOnly ? (
              <Button variant="primary" onClick={machine.confirm}>
                {t('confirm')}
              </Button>
            ) : null}
          </>
        }
      >
        <PendingDiff
          changes={changes}
          onDiscard={canDiscard ? (key) => discard.mutate([key]) : undefined}
          discarding={discard.isPending}
        />
        {needsRecreate ? (
          <>
            <p className="text-xs text-muted">{t('confirmPanel')}</p>
            <p className="mt-1 text-xs text-muted">{t('confirmProjects')}</p>
            {status?.movesPanel ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('confirmMoves')}</span>
              </p>
            ) : null}
            {/* The difference between ten seconds and five minutes. Without it, a
                first apply on a checkout reads as a hang. */}
            {status?.buildsImages ? <p className="mt-2 text-xs text-muted">{t('confirmBuild')}</p> : null}
            <p className="mt-2 text-xs text-subtle">{t('confirmKeepTab')}</p>
          </>
        ) : null}
      </Dialog>
    )
  }

  if (busy) {
    return (
      <Dialog open dismissible={false} onOpenChange={() => {}} title={t('title')} description={t('keepTabOpen')}>
        <div className="flex items-center gap-2 text-sm text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          {/* Spelled out rather than interpolated: only these three phases
              are busy, and the keys are type-checked against the catalogue. */}
          <span>
            {phase === 'starting'
              ? t('phase.starting')
              : phase === 'applying'
                ? t('phase.applying')
                : t('phase.waiting')}
          </span>
          <Mono kind="text" className="ml-auto tabular-nums">
            {mmss(elapsedSeconds)}
          </Mono>
        </div>
        {/* The step list is the progress indicator. A percentage bar would be a
            guess: nothing here knows how long recreating this host takes. */}
        <ol className="mt-3 space-y-1 text-xs" aria-live="polite">
          <Step done label={t('steps.started')} />
          <Step done={sawOffline} active={!sawOffline} label={t('steps.offline')} />
          <Step done={false} active={sawOffline} label={t('steps.back')} />
          <Step done={false} label={t('steps.applied')} />
        </ol>
      </Dialog>
    )
  }

  if (phase === 'reconnected') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('phase.reconnected')}
        footer={
          <>
            <Button variant="ghost" onClick={machine.dismiss}>
              {tc('close')}
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('reload')}
            </Button>
          </>
        }
      >
        <ol className="space-y-1 text-xs">
          <Step done label={t('steps.started')} />
          <Step done={sawOffline} label={t('steps.offline')} />
          <Step done label={t('steps.back')} />
          <Step done label={t('steps.applied')} />
        </ol>
        {/* The page is still showing data the previous process answered with. */}
        <p className="mt-3 text-xs text-muted">{t('reloadWhy')}</p>
      </Dialog>
    )
  }

  if (phase === 'failed') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('phase.failed')}
        footer={
          <Button variant="ghost" onClick={machine.dismiss}>
            {tc('close')}
          </Button>
        }
      >
        <p className="text-sm text-danger">{t('failedExit', { code: status?.exitCode ?? '?' })}</p>
        {status && status.logTail.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">{t('showOutput')}</summary>
            <Pre className="mt-2">{status.logTail.join('\n')}</Pre>
          </details>
        ) : null}
        <p className="mt-3 text-xs text-muted">{t('failedHint')}</p>
        <Command value={command} />
      </Dialog>
    )
  }

  if (phase === 'timeout') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('phase.timeout')}
        footer={
          <>
            <Button variant="ghost" onClick={machine.dismiss}>
              {tc('close')}
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('reload')}
            </Button>
          </>
        }
      >
        {/* Deliberately not "it failed": a slow host and a broken one look the
            same from a browser that cannot reach the panel. */}
        <p className="text-sm text-warn">{t('timeoutBody', { time: mmss(elapsedSeconds) })}</p>
        <Command value={command} />
      </Dialog>
    )
  }

  return null
}
