'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/toast'
import { taskflowLocation } from '../../lib/navigation.ts'
import { useTaskflowProject } from '../../lib/project.tsx'
import { useRuns } from '../../lib/queries/runs.ts'
import { errorMessage } from '../../lib/utils.ts'
import { useSidebarState } from '../shell/sidebar-state.tsx'
import { useWorktreeActions } from '../worktrees/worktree-actions.tsx'
import { useWorktreeSelection } from '../worktrees/worktree-selection.tsx'
import { RunList } from './run-list.tsx'

/** The Runs sidebar: durable Runs, and the direct sessions that have no Run of their own. */
export function RunSidebar() {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'list' })
  const router = useRouter()
  const toast = useToast()
  const { paths, slug } = useTaskflowProject()
  const { id } = taskflowLocation(usePathname(), slug)
  const { closeOnMobile } = useSidebarState()
  const { worktrees } = useWorktreeSelection()
  const { openRunSession } = useWorktreeActions()
  const runs = useRuns()
  const runList = useMemo(() => runs.data ?? [], [runs.data])
  const directSessions = useMemo(
    () =>
      worktrees.filter(
        (worktree) => !runList.some((run) => run.mode === 'direct' && run.workspace?.branch === worktree.branch),
      ),
    [runList, worktrees],
  )

  useEffect(() => {
    if (runs.error) toast.push({ tone: 'danger', title: t('loadFailed', { error: errorMessage(runs.error) }) })
  }, [runs.error, t, toast])

  return (
    <RunList
      runs={runList}
      directSessions={directSessions}
      selectedId={id ?? null}
      onSelect={(runId) => {
        router.push(paths.run(runId))
        closeOnMobile()
      }}
      onSelectSession={openRunSession}
    />
  )
}
