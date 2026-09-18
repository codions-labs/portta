'use client'

import { Trans, useTranslation } from 'react-i18next'
import type { WorkflowWorkspacePolicy, WorkspaceStrategy } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'

interface WorkspaceStrategySelectorProps {
  value: WorkspaceStrategy
  policy: WorkflowWorkspacePolicy
  currentBranch?: string | null
  onChange: (value: WorkspaceStrategy) => void
}

const options: WorkspaceStrategy[] = ['isolated_worktree', 'new_branch', 'current_branch']

export function WorkspaceStrategySelector({
  value,
  policy,
  currentBranch = null,
  onChange,
}: WorkspaceStrategySelectorProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'workspaceStrategy' })
  return (
    <fieldset className="mt-5 border-t border-line pt-5">
      <legend className="text-sm font-medium text-ink">{t('legend')}</legend>
      {policy.reason ? <p className="mt-1 text-xs leading-5 text-subtle">{policy.reason}</p> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const allowed = policy.allowed.includes(option)
          return (
            <label
              key={option}
              className={cn(
                'rounded-md border p-3 text-left transition-colors duration-100',
                value === option ? 'border-accent bg-selection' : 'border-line bg-surface',
                allowed ? 'cursor-pointer hover:bg-fill' : 'cursor-not-allowed opacity-45',
              )}
            >
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  name="workspace-strategy"
                  checked={value === option}
                  disabled={!allowed}
                  onChange={() => onChange(option)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{t(`options.${option}.label`)}</span>
                  <span className="mt-1 block text-2xs leading-4 text-subtle">{t(`options.${option}.detail`)}</span>
                </span>
              </span>
              {option === policy.default ? (
                <span className="mt-2 block text-2xs font-medium uppercase tracking-wide text-accent">
                  {t('recommended')}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
      {value === 'current_branch' ? (
        <p className="mt-3 rounded-md border border-warn/35 bg-warn/8 px-3 py-2 text-xs text-ink">
          {currentBranch ? (
            <Trans
              t={t}
              i18nKey="currentBranchWarning"
              values={{ branch: currentBranch }}
              components={{ mono: <span className="font-mono" /> }}
            />
          ) : (
            t('currentBranchWarningActive')
          )}
        </p>
      ) : null}
    </fieldset>
  )
}
