'use client'

// What can be done to several containers at once. Removing is the one that asks
// for a typed confirmation: it keeps volumes, but it cannot be taken back.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check } from 'lucide-react'
import type { ContainerSummary } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { useFormat } from '@/lib/use-format'
import { LogViewer } from '../logs.tsx'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Dialog } from '../ui/dialog.tsx'
import { useToast } from '../ui/toast.tsx'

type BulkAction = 'start' | 'stop' | 'restart' | 'remove'

/** Docker refuses to remove anything still alive unless it is told to stop it. */
const ALIVE = new Set<ContainerSummary['state']>(['running', 'restarting', 'paused'])

function messageOf(reason: unknown): string {
  if (reason instanceof ApiError) return [reason.message, reason.hint].filter(Boolean).join(' · ')
  return reason instanceof Error ? reason.message : String(reason)
}

/** The output of several containers as one stream, oldest first. */
async function mergedLogs(containers: ContainerSummary[], tail: number) {
  const results = await Promise.allSettled(containers.map((container) => api.logs(container.id, tail)))
  const lines = results.flatMap((result, index) =>
    result.status === 'fulfilled'
      ? result.value.lines.map((line) => ({ ...line, service: containers[index]?.name ?? '' }))
      : [
          {
            stream: 'stderr' as const,
            timestamp: null,
            text: messageOf(result.reason),
            service: containers[index]?.name ?? '',
          },
        ],
  )
  const dated = lines.filter((line) => line.timestamp !== null)
  dated.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
  return {
    lines: [...lines.filter((line) => line.timestamp === null), ...dated],
    truncated: results.some((result) => result.status === 'fulfilled' && result.value.truncated),
    ordered: dated.length === lines.length,
  }
}

const ON_ACCENT = 'border-current/40 bg-transparent text-accent-fg hover:bg-current/15 hover:text-accent-fg'

export function ContainerBulkBar({ selected, onClear }: { selected: ContainerSummary[]; onClear: () => void }) {
  const { t } = useTranslation('docker', { keyPrefix: 'bulk' })
  const { shortImage } = useFormat()
  const queryClient = useQueryClient()
  const toast = useToast()
  const mayOperate = useCan('container:operate')
  const mayRemove = useCan('container:destroy')
  const mayReadLogs = useCan('logs:read')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

  const count = selected.length
  const toStart = selected.filter((container) => container.state !== 'running')
  const toStop = selected.filter((container) => container.state === 'running')

  const run = useMutation({
    mutationFn: async ({ action, targets }: { action: BulkAction; targets: ContainerSummary[] }) => {
      const results = await Promise.allSettled(
        targets.map((container) =>
          action === 'remove'
            ? api.removeContainer(container.id, ALIVE.has(container.state))
            : api.containerAction(container.id, action),
        ),
      )
      return results.flatMap((result, index) =>
        result.status === 'rejected' ? [{ name: targets[index]?.name ?? '', reason: result.reason as unknown }] : [],
      )
    },
    onSuccess: (failures, { action, targets }) => {
      setConfirmRemove(false)
      void queryClient.invalidateQueries()
      if (failures.length === 0) {
        toast.push({ tone: 'ok', title: t(`done.${action}`, { count: targets.length }) })
        if (action === 'remove') onClear()
        return
      }
      toast.push({
        tone: 'danger',
        title: t('partial', { failed: failures.length, count: targets.length }),
        description: failures.map((failure) => `${failure.name}: ${messageOf(failure.reason)}`).join('\n'),
      })
    },
  })

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('aria')}
        className="flex flex-wrap items-center gap-2 rounded-xl bg-accent py-2 pr-2 pl-4 text-accent-fg"
      >
        <b className="min-w-40 flex-1 text-sm font-semibold">{t('selected', { count })}</b>
        {mayOperate ? (
          <>
            <Button
              size="sm"
              className={ON_ACCENT}
              disabled={run.isPending || toStart.length === 0}
              onClick={() => run.mutate({ action: 'start', targets: toStart })}
            >
              {t('start')}
            </Button>
            <Button
              size="sm"
              className={ON_ACCENT}
              disabled={run.isPending || toStop.length === 0}
              onClick={() => run.mutate({ action: 'stop', targets: toStop })}
            >
              {t('stop')}
            </Button>
            <Button
              size="sm"
              className={ON_ACCENT}
              disabled={run.isPending}
              onClick={() => run.mutate({ action: 'restart', targets: selected })}
            >
              {t('restart')}
            </Button>
          </>
        ) : null}
        {mayReadLogs ? (
          <Button size="sm" className={ON_ACCENT} onClick={() => setShowLogs(true)}>
            {t('logs')}
          </Button>
        ) : null}
        {mayRemove ? (
          <Button
            size="sm"
            className={`${ON_ACCENT} border-red-400`}
            disabled={run.isPending}
            onClick={() => setConfirmRemove(true)}
          >
            {t('remove')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className={`${ON_ACCENT} border-transparent`} onClick={onClear}>
          {t('clear')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('confirm.title', { count })}
        impact={null}
        details={
          <div className="space-y-3">
            <ul className="max-h-40 space-y-1 overflow-y-auto scroll-thin">
              {selected.map((container) => (
                <li key={container.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono">{container.name}</span>
                  <span className="shrink-0 text-xs text-subtle">{shortImage(container.image)}</span>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 border-t border-line pt-3">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              {t('confirm.kept')}
            </p>
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              {t('confirm.lost')}
            </p>
          </div>
        }
        requireTyped={t('confirm.typed', { count })}
        requireTypedHint={t('confirm.typedHint', { typed: t('confirm.typed', { count }) })}
        confirmLabel={t('confirm.action', { count })}
        busy={run.isPending}
        onConfirm={() => run.mutate({ action: 'remove', targets: selected })}
      />

      <Dialog
        open={showLogs}
        onOpenChange={setShowLogs}
        title={t('logsTitle', { count })}
        description={selected.map((container) => container.name).join(', ')}
        size="lg"
      >
        <div className="h-[55vh] min-h-0">
          <LogViewer
            showOrigin
            queryKey={['docker', 'containers', 'logs', ...selected.map((container) => container.id)]}
            load={(tail) => mergedLogs(selected, tail)}
            className="h-full rounded-md border border-line"
          />
        </div>
      </Dialog>
    </>
  )
}
