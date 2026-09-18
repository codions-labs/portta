'use client'

import { PATH_NAMES, PROJECT_CONFIG_DIR } from 'portta-core/taskflow/config'
import { Trans, useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { WorkflowDefinition } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { groupWorkflows, workflowTitle } from '../../lib/workflow-catalog.ts'

interface WorkflowCatalogPickerProps {
  workflows: WorkflowDefinition[]
  selectedId: string
  loading?: boolean
  onChange: (workflowId: string) => void
}

export function WorkflowCatalogPicker({
  workflows,
  selectedId,
  loading = false,
  onChange,
}: WorkflowCatalogPickerProps) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'workflows' })
  const groups = groupWorkflows(workflows)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-ink">{t('picker.title')}</h3>
        <p className="mt-1 text-xs leading-5 text-subtle">{t('picker.description')}</p>
      </div>
      {loading ? (
        <p className="rounded-md border border-line bg-surface px-3 py-3 text-xs text-subtle">{t('loading')}</p>
      ) : groups.length === 0 ? (
        <p className="rounded-md border border-line bg-surface px-3 py-3 text-xs text-subtle">
          <Trans
            t={t}
            i18nKey="emptyHint"
            values={{ path: `${PROJECT_CONFIG_DIR}/${PATH_NAMES.workflows}` }}
            components={{ code: <code className="font-mono" /> }}
          />
        </p>
      ) : (
        <div className="max-h-80 space-y-5 overflow-y-auto pr-1 scroll-thin">
          {groups.map((group) => (
            <section aria-labelledby={`workflow-group-${group.origin}`} key={group.origin}>
              <h4 id={`workflow-group-${group.origin}`} className="mb-2 text-xs font-medium text-muted">
                {t(`origin.${group.origin}`)}
              </h4>
              <div className="space-y-2">
                {group.workflows.map((workflow) => {
                  const unavailable = workflow.availability === 'unavailable'
                  const selected = selectedId === workflow.id
                  return (
                    <label
                      className={cn(
                        'block rounded-md border p-3 transition-colors duration-100',
                        unavailable
                          ? 'cursor-not-allowed border-line bg-surface-2/60 opacity-60'
                          : selected
                            ? 'cursor-pointer border-accent bg-selection'
                            : 'cursor-pointer border-line bg-surface hover:bg-fill',
                      )}
                      key={workflow.id}
                    >
                      <input
                        type="radio"
                        name="workflow"
                        value={workflow.id}
                        checked={selected}
                        disabled={unavailable}
                        onChange={() => onChange(workflow.id)}
                        className="sr-only"
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium text-ink">{workflowTitle(workflow.name)}</span>
                            <Badge tone="outline">{t(`origin.${workflow.origin}`)}</Badge>
                          </div>
                          <p className="mt-1 text-2xs text-subtle">{workflow.name}</p>
                          <p className="mt-2 text-xs leading-5 text-muted">{workflow.description}</p>
                          {workflow.phases.length > 0 ? (
                            <p className="mt-2 text-2xs text-subtle">
                              {workflow.phases.map((phase) => phase.label).join(' → ')}
                            </p>
                          ) : null}
                          {unavailable ? (
                            <p className="mt-2 text-2xs text-danger">{workflow.diagnostics[0] ?? t('unavailable')}</p>
                          ) : null}
                        </div>
                        <span
                          className={cn(
                            'mt-0.5 size-4 shrink-0 rounded-full border',
                            selected ? 'border-accent bg-accent ring-2 ring-accent/25' : 'border-line-strong',
                          )}
                        />
                      </div>
                    </label>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
