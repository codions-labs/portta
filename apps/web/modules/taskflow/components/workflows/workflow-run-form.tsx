'use client'

import { JsonValueSchema } from 'portta-contracts/taskflow'
import { APP_NAME } from 'portta-core/taskflow/config'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import type {
  AgentPermissionMode,
  AgentTransport,
  AvailableBranch,
  CreateRunRequest,
  ProfileConfig,
  RunWorkspaceContext,
  WorkflowDefinition,
  WorkspaceStrategy,
} from '../../lib/types.ts'
import { AgentTransportFields } from '../agents/agent-transport-fields.tsx'
import { BranchSelector } from '../worktrees/branch-selector.tsx'
import { WorkspaceStrategySelector } from '../worktrees/workspace-strategy-selector.tsx'
import { WorkflowCatalogPicker } from './workflow-catalog-picker.tsx'

interface WorkflowRunFormProps {
  workflows: WorkflowDefinition[]
  loading?: boolean
  profiles: ProfileConfig[]
  defaultProfileName: string
  baseBranches?: AvailableBranch[]
  workspaceContext?: RunWorkspaceContext | null
  initialWorkflowId?: string | null
  /** When the actions live outside the form (a dialog footer), the form is submitted by this id. */
  formId?: string
  onReadyChange?: (ready: boolean) => void
  onCreate: (request: CreateRunRequest) => void
  onCancel: () => void
}

export function WorkflowRunForm({
  workflows,
  loading = false,
  profiles,
  defaultProfileName,
  baseBranches = [],
  workspaceContext = null,
  initialWorkflowId = null,
  formId,
  onReadyChange,
  onCreate,
  onCancel,
}: WorkflowRunFormProps) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'runForm' })
  const { t: tw } = useTranslation('taskflow-worktrees', { keyPrefix: 'createDialog' })
  const { t: tc } = useTranslation('common')
  const [workflowId, setWorkflowId] = useState(initialWorkflowId ?? '')
  const [inputMode, setInputMode] = useState<'text' | 'json'>('text')
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [workspaceStrategy, setWorkspaceStrategy] = useState<WorkspaceStrategy>('isolated_worktree')
  const [branch, setBranch] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [transport, setTransport] = useState<AgentTransport>('native')
  const [permissionMode, setPermissionMode] = useState<Exclude<AgentPermissionMode, 'interactive'>>('workspace')
  const selectedWorkflow = workflows.find((workflow) => workflow.id === workflowId) ?? null
  const ready = Boolean(selectedWorkflow && selectedWorkflow.availability !== 'unavailable')

  useEffect(() => {
    if (!profiles.some((option) => option.name === profile)) setProfile(defaultProfileName || profiles[0]?.name || '')
  }, [defaultProfileName, profile, profiles])

  useEffect(() => {
    if (selectedWorkflow) setWorkspaceStrategy(selectedWorkflow.workspace.default)
  }, [selectedWorkflow])

  useEffect(() => {
    onReadyChange?.(ready)
  }, [onReadyChange, ready])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!selectedWorkflow) {
      setError(t('chooseWorkflow'))
      return
    }
    if (selectedWorkflow.availability === 'unavailable') {
      setError(selectedWorkflow.diagnostics[0] ?? t('unavailable'))
      return
    }

    let value = JsonValueSchema.parse(input)
    if (inputMode === 'json') {
      try {
        value = JsonValueSchema.parse(JSON.parse(input || '{}'))
      } catch {
        setError(t('invalidJson'))
        return
      }
    }

    const workspace: CreateRunRequest['workspace'] =
      workspaceStrategy === 'current_branch'
        ? { strategy: 'current_branch' }
        : {
            strategy: workspaceStrategy,
            ...(branch.trim() ? { branch: branch.trim() } : {}),
            ...(baseBranch ? { baseBranch } : {}),
          }
    onCreate({
      mode: 'workflow',
      workflowId,
      input: value,
      workspace,
      profile: profile || undefined,
      idempotencyKey: crypto.randomUUID(),
      transport,
      permissionMode,
      mcpServers: [],
    })
  }

  return (
    <form id={formId} onSubmit={submit}>
      <WorkflowCatalogPicker workflows={workflows} selectedId={workflowId} loading={loading} onChange={setWorkflowId} />
      <div className="mt-5 border-t border-line pt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <label className="block text-sm font-medium text-ink" htmlFor="workflow-input">
              {t('input')}
            </label>
            <p className="mt-1 text-xs text-subtle">{t('inputHint')}</p>
          </div>
          <Segmented
            label={t('inputMode')}
            value={inputMode}
            onChange={setInputMode}
            options={[
              { value: 'text', label: t('text') },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </div>
        <Textarea
          id="workflow-input"
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          rows={5}
          className="mt-3 resize-y"
          placeholder={inputMode === 'json' ? '{"task":"Review the current branch"}' : t('textPlaceholder')}
        />
      </div>
      {selectedWorkflow ? (
        <>
          <WorkspaceStrategySelector
            value={workspaceStrategy}
            policy={selectedWorkflow.workspace}
            currentBranch={workspaceContext?.branch ?? null}
            onChange={setWorkspaceStrategy}
          />
          {workspaceStrategy !== 'current_branch' ? (
            <>
              <Field
                className="mt-4"
                label={
                  <>
                    {tw('branchName')} <span className="opacity-60">{tw('optional')}</span>
                  </>
                }
                id="workflow-branch"
              >
                <Input
                  id="workflow-branch"
                  value={branch}
                  onChange={(event) => setBranch(event.currentTarget.value)}
                  placeholder={t('branchPlaceholder')}
                />
              </Field>
              <div className="mt-4">
                <BranchSelector
                  label={tw('baseBranch')}
                  selected={baseBranch}
                  branches={baseBranches}
                  placeholder={tw('baseBranchPlaceholder')}
                  onSelect={setBaseBranch}
                />
              </div>
            </>
          ) : null}
          {workspaceStrategy === 'new_branch' && workspaceContext?.dirty ? (
            <p className="mt-3 text-xs text-warn">{tw('dirtyCheckout', { app: APP_NAME })}</p>
          ) : null}
        </>
      ) : null}
      {profiles.length > 1 ? (
        <Field className="mt-4" label={t('profile')} id="workflow-profile">
          <Select
            id="workflow-profile"
            className="w-full"
            value={profile}
            onChange={(event) => setProfile(event.currentTarget.value)}
          >
            {profiles.map((option) => (
              <option value={option.name} key={option.name}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="mt-4">
        <AgentTransportFields
          transport={transport}
          permissionMode={permissionMode}
          allowInteractive={false}
          onTransportChange={setTransport}
          onPermissionModeChange={(mode) => setPermissionMode(mode === 'deny' ? 'deny' : 'workspace')}
        />
      </div>
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {formId ? null : (
        <div className="mt-6 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!ready}>
            {t('start')}
          </Button>
        </div>
      )}
    </form>
  )
}
