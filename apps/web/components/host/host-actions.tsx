'use client'

// What can be done to the machine from any of its tabs: restart its router, or
// ask it how it is.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleHelp, RotateCw, Stethoscope, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { DiagnosticText } from '@/components/diagnostic-text'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { useFormat } from '@/lib/use-format'

export type GatewayRestart = Awaited<ReturnType<typeof api.restartGateway>>

function CheckIcon({ status }: { status: string }) {
  if (status === 'pass') return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
  if (status === 'info') return <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-info" />
  if (status === 'warn') return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
  return <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
}

export function HostActions({ onRestarted }: { onRestarted: (result: GatewayRestart) => void }) {
  const { t } = useTranslation('gateway')
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const toast = useToast()
  const mayRead = useCan('gateway:read')
  const mayRestart = useCan('gateway:operate')
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [showReport, setShowReport] = useState(false)

  const failed = (error: unknown) =>
    toast.push({ tone: 'danger', title: t('actionFailed'), description: error instanceof Error ? error.message : '' })

  const doctor = useMutation({ mutationFn: api.doctor, onSuccess: () => setShowReport(true), onError: failed })
  const restart = useMutation({
    mutationFn: () => api.restartGateway(['traefik']),
    onSuccess: (result) => {
      setConfirmRestart(false)
      onRestarted(result)
      void queryClient.invalidateQueries()
    },
    onError: (error) => {
      setConfirmRestart(false)
      failed(error)
    },
  })

  return (
    <>
      {mayRestart ? (
        <Button onClick={() => setConfirmRestart(true)}>
          <RotateCw />
          {t('restartTraefik')}
        </Button>
      ) : null}
      {mayRead ? (
        <Button variant="primary" busy={doctor.isPending} onClick={() => doctor.mutate()}>
          <Stethoscope />
          {doctor.isPending ? t('checking') : t('runDiagnostics')}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        tone="default"
        title={t('restartConfirm.title')}
        impact={t('restartConfirm.impact')}
        confirmLabel={t('restartConfirm.confirm')}
        busy={restart.isPending}
        onConfirm={() => restart.mutate()}
      />

      <Dialog
        open={showReport}
        onOpenChange={setShowReport}
        title={t('diagnostics.title')}
        description={
          doctor.data
            ? t('diagnostics.summary', {
                failures: doctor.data.failures,
                warnings: doctor.data.warnings,
                time: relativeTime(doctor.data.ranAt),
              })
            : undefined
        }
        size="lg"
      >
        {doctor.data ? (
          <>
            <ul className="max-h-[55vh] divide-y divide-line-subtle overflow-y-auto scroll-thin">
              {doctor.data.checks.map((check) => (
                <li key={check.id} className="flex gap-2 py-2">
                  <CheckIcon status={check.status} />
                  <div className="min-w-0">
                    <DiagnosticText diagnostic={check} part="title" className="text-sm font-medium text-ink" />
                    <DiagnosticText diagnostic={check} part="detail" className="text-xs text-muted" />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-xs text-subtle">
              {t('diagnostics.deeperChecks')}{' '}
              <Mono kind="command" tone="muted">
                {doctor.data.hostCommand}
              </Mono>
            </p>
          </>
        ) : null}
      </Dialog>
    </>
  )
}
