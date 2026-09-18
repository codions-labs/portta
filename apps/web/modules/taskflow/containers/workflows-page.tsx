'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkflowDetail } from '../components/workflows/workflow-detail.tsx'
import { useWorktreeActions } from '../components/worktrees/worktree-actions.tsx'
import { useTaskflowProject } from '../lib/project.tsx'
import { useWorkflows } from '../lib/queries/runs.ts'

/** `…/workflows`: opens the first workflow of the catalog, the way the section always did. */
export function WorkflowsPage() {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'workflows' })
  const router = useRouter()
  const { paths } = useTaskflowProject()
  const workflows = useWorkflows()
  const first = workflows.data?.[0]

  useEffect(() => {
    if (first) router.replace(paths.workflow(first.id))
  }, [first, paths, router])

  return <div className="flex flex-1 items-center justify-center text-sm text-subtle">{t('selectPrompt')}</div>
}

/** `…/workflows/<id>`: what a workflow does, and the way to start it. */
export function WorkflowPage({ id }: { id: string }) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'workflows' })
  const { openCreate, allowed } = useWorktreeActions()
  const workflows = useWorkflows()
  const workflow = workflows.data?.find((candidate) => candidate.id === id)

  if (!workflow) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-subtle">
        {workflows.isPending ? t('catalogLoading') : t('selectPrompt')}
      </div>
    )
  }
  return (
    <WorkflowDetail
      workflow={workflow}
      onStart={allowed.runCreate ? (workflowId) => openCreate(null, workflowId) : undefined}
    />
  )
}
