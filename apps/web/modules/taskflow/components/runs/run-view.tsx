'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/toast'
import { useExecutionTranscript, useRunTimeline } from '../../lib/live.ts'
import { useTaskflowCan, useTaskflowProject } from '../../lib/project.tsx'
import { useRun } from '../../lib/queries/runs.ts'
import type { RunDetailResponse } from '../../lib/types.ts'
import { errorMessage } from '../../lib/utils.ts'
import { useWorktreeActions } from '../worktrees/worktree-actions.tsx'
import { RunDetail } from './run-detail.tsx'

/** A Run's page: its detail, its live journal and, when one is picked, an execution's transcript. */
export function RunView({ runId }: { runId: string }) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'view' })
  const queryClient = useQueryClient()
  const { api, keys } = useTaskflowProject()
  const canCancel = useTaskflowCan('run:cancel')
  const canResume = useTaskflowCan('run:create')
  const canRespond = useTaskflowCan('run:permission')
  const toast = useToast()
  const { openRunSession } = useWorktreeActions()
  const run = useRun(runId)
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)
  const notifyRunStream = useCallback(
    () => toast.push({ tone: 'danger', title: t('runStreamDisconnected') }),
    [t, toast],
  )
  const notifyTranscriptStream = useCallback(
    () => toast.push({ tone: 'danger', title: t('transcriptStreamDisconnected') }),
    [t, toast],
  )
  const timeline = useRunTimeline(runId, notifyRunStream)
  const selectedExecution = run.data?.run.executions.find((execution) => execution.id === selectedExecutionId)
  const transcript = useExecutionTranscript(
    selectedExecutionId,
    Boolean(selectedExecution?.observability?.transcript),
    notifyTranscriptStream,
  )

  useEffect(() => {
    if (run.error) toast.push({ tone: 'danger', title: t('loadFailed', { error: errorMessage(run.error) }) })
  }, [run.error, t, toast])

  useEffect(() => {
    if (transcript.error)
      toast.push({ tone: 'danger', title: t('transcriptLoadFailed', { error: errorMessage(transcript.error) }) })
  }, [t, toast, transcript.error])

  async function update(
    request: () => Promise<RunDetailResponse>,
    failure: 'cancelFailed' | 'resumeFailed' | 'permissionFailed',
  ): Promise<void> {
    try {
      queryClient.setQueryData(keys.run(runId), await request())
      await queryClient.invalidateQueries({ queryKey: keys.runs() })
    } catch (error) {
      toast.push({ tone: 'danger', title: t(failure, { error: errorMessage(error) }) })
    }
  }

  if (!run.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-subtle">
        {run.isPending ? t('loading') : t('unavailable')}
      </div>
    )
  }

  return (
    <RunDetail
      detail={run.data}
      allowed={{ cancel: canCancel, resume: canResume, respond: canRespond }}
      timeline={timeline}
      selectedExecutionId={selectedExecutionId}
      transcriptEntries={transcript.entries}
      transcriptLoading={transcript.loading}
      onSelectExecution={setSelectedExecutionId}
      onCloseExecution={() => setSelectedExecutionId(null)}
      onCancel={(id) => {
        void update(() => api.cancelRun(id), 'cancelFailed')
      }}
      onResume={(id) => {
        void update(() => api.resumeRun(id), 'resumeFailed')
      }}
      onRespondPermission={(id, requestId, optionId) => {
        void update(() => api.respondRunPermission(id, requestId, optionId), 'permissionFailed')
      }}
      onOpenSession={openRunSession}
    />
  )
}
