'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/toast'
import { taskflowLocation } from '../../lib/navigation.ts'
import { useTaskflowProject } from '../../lib/project.tsx'
import { useWorkflows } from '../../lib/queries/runs.ts'
import { errorMessage } from '../../lib/utils.ts'
import { useSidebarState } from '../shell/sidebar-state.tsx'
import { WorkflowCatalog } from './workflow-catalog.tsx'

/** The Workflows sidebar: the catalog, grouped by where each workflow comes from. */
export function WorkflowSidebar() {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'workflows' })
  const router = useRouter()
  const toast = useToast()
  const { paths, slug } = useTaskflowProject()
  const { id } = taskflowLocation(usePathname(), slug)
  const { closeOnMobile } = useSidebarState()
  const workflows = useWorkflows()

  useEffect(() => {
    if (workflows.error)
      toast.push({ tone: 'danger', title: t('loadFailed', { error: errorMessage(workflows.error) }) })
  }, [t, toast, workflows.error])

  return (
    <WorkflowCatalog
      workflows={workflows.data ?? []}
      loading={workflows.isPending}
      selectedId={id ?? null}
      onSelect={(workflowId) => {
        router.push(paths.workflow(workflowId))
        closeOnMobile()
      }}
    />
  )
}
