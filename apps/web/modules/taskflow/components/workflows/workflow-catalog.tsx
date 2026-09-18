'use client'

import { useTranslation } from 'react-i18next'
import type { WorkflowDefinition } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { groupWorkflows, workflowTitle } from '../../lib/workflow-catalog.ts'

interface WorkflowCatalogProps {
  workflows: WorkflowDefinition[]
  loading: boolean
  selectedId?: string | null
  onSelect: (workflowId: string) => void
}

export function WorkflowCatalog({ workflows, loading, selectedId = null, onSelect }: WorkflowCatalogProps) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'workflows' })
  const groups = groupWorkflows(workflows)

  if (loading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 py-6 text-center text-xs text-subtle">{t('catalogLoading')}</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 py-6 text-center text-xs leading-5 text-subtle">{t('catalogEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      {groups.map((group) => (
        <section key={group.origin}>
          <h2 className="sticky top-0 z-10 flex h-8 items-center border-y border-line bg-surface-2 px-3 text-xs font-medium text-muted">
            {t(`origin.${group.origin}`)}
          </h2>
          <ul className="divide-y divide-line">
            {group.workflows.map((workflow) => (
              <li key={workflow.id}>
                <button
                  type="button"
                  className={cn(
                    'w-full border-l-2 px-3 py-3 text-left transition-colors duration-100 focus-ring-inset',
                    selectedId === workflow.id ? 'border-l-accent bg-selection' : 'border-l-transparent hover:bg-fill',
                  )}
                  onClick={() => onSelect(workflow.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {workflowTitle(workflow.name)}
                    </span>
                    <span
                      className={cn(
                        'text-2xs uppercase tracking-wide',
                        workflow.availability === 'available' ? 'text-ok' : 'text-danger',
                      )}
                    >
                      {t(`availability.${workflow.availability}`)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-2xs leading-4 text-subtle">{workflow.description}</p>
                  <p className="mt-2 text-2xs text-subtle">
                    {t('phases', { count: workflow.phases.length })} · {t(`origin.${workflow.origin}`)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
