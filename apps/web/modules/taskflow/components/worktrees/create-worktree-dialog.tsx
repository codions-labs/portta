'use client'

import { parseLinearTarget } from 'portta-contracts/taskflow'
import { APP_DEFAULTS, APP_NAME } from 'portta-core/taskflow/config'
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import type {
  AgentId,
  AgentPermissionMode,
  AgentSummary,
  AgentTransport,
  AvailableBranch,
  BuiltInAgentId,
  CreateRunRequest,
  CreateWorktreeRequest,
  ProfileConfig,
  RunWorkspaceContext,
  WorkflowDefinition,
  WorkflowWorkspacePolicy,
  WorkspaceStrategy,
  WorktreeCreateMode,
} from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { AgentTransportFields } from '../agents/agent-transport-fields.tsx'
import { WorkflowRunForm } from '../workflows/workflow-run-form.tsx'
import { BranchSelector } from './branch-selector.tsx'
import { StartupEnvFields } from './startup-env-fields.tsx'
import { WorkspaceStrategySelector } from './workspace-strategy-selector.tsx'

interface CreateWorktreeDialogProps {
  profiles: ProfileConfig[]
  agents?: AgentSummary[]
  defaultProfileName?: string
  defaultAgentId?: BuiltInAgentId
  autoNameEnabled?: boolean
  initialBranch?: string
  initialPrompt?: string
  availableBranches?: AvailableBranch[]
  availableBranchesLoading?: boolean
  availableBranchesError?: string | null
  baseBranches?: AvailableBranch[]
  baseBranchesLoading?: boolean
  baseBranchesError?: string | null
  lockedBaseBranch?: string | null
  includeRemoteBranches: boolean
  onIncludeRemoteBranchesChange: (included: boolean) => void
  startupEnvs?: Record<string, string | boolean>
  linearCreateTicketOption?: boolean
  openedFromLinearIssue?: boolean
  workflows?: WorkflowDefinition[]
  workflowsLoading?: boolean
  initialWorkflowId?: string | null
  workspaceContext?: RunWorkspaceContext | null
  onCreate: (request: CreateWorktreeRequest) => void
  onRunCreate: (request: CreateRunRequest) => void
  onCancel: () => void
}

const STORAGE_KEY = 'wt-default-profile'
const AGENT_STORAGE_KEY = 'wt-default-agents'
const MULTI_AGENT_STORAGE_KEY = 'wt-default-multi-agents'
const ENV_STORAGE_KEY = 'wt-default-envs'
const LINEAR_TEAM_KEY_STORAGE_KEY = 'wt-linear-team-key'

function loadSavedAgentIds(): AgentId[] {
  const saved = localStorage.getItem(AGENT_STORAGE_KEY)
  if (!saved) return []
  try {
    const parsed: unknown = JSON.parse(saved)
    if (Array.isArray(parsed))
      return parsed.filter((entry): entry is AgentId => typeof entry === 'string' && entry.trim().length > 0)
  } catch {
    return saved.trim() ? [saved.trim()] : []
  }
  return saved.trim() ? [saved.trim()] : []
}

function loadSavedEnvs(startupEnvs: Record<string, string | boolean>): Record<string, string | boolean> {
  const saved = localStorage.getItem(ENV_STORAGE_KEY)
  if (!saved) return { ...startupEnvs }
  try {
    const parsed: unknown = JSON.parse(saved)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...startupEnvs }
    const filtered: Record<string, string | boolean> = {}
    for (const [key, value] of Object.entries(parsed))
      if (key in startupEnvs && (typeof value === 'string' || typeof value === 'boolean')) filtered[key] = value
    return { ...startupEnvs, ...filtered }
  } catch {
    return { ...startupEnvs }
  }
}

const workspacePolicy: Omit<WorkflowWorkspacePolicy, 'reason'> = {
  default: 'isolated_worktree',
  allowed: ['isolated_worktree', 'new_branch', 'current_branch'],
  mutatesRepository: true,
}

export function CreateWorktreeDialog({
  profiles,
  agents = [],
  defaultProfileName = '',
  defaultAgentId = APP_DEFAULTS.defaultAgent,
  autoNameEnabled = false,
  initialBranch = '',
  initialPrompt = '',
  availableBranches = [],
  availableBranchesLoading = false,
  availableBranchesError = null,
  baseBranches = [],
  baseBranchesLoading = false,
  baseBranchesError = null,
  lockedBaseBranch = null,
  includeRemoteBranches,
  onIncludeRemoteBranchesChange,
  startupEnvs = {},
  linearCreateTicketOption = false,
  openedFromLinearIssue = false,
  workflows = [],
  workflowsLoading = false,
  initialWorkflowId = null,
  workspaceContext = null,
  onCreate,
  onRunCreate,
  onCancel,
}: CreateWorktreeDialogProps) {
  const savedProfile = localStorage.getItem(STORAGE_KEY)
  const savedEnvs = localStorage.getItem(ENV_STORAGE_KEY)
  const [runMode, setRunMode] = useState<'direct' | 'workflow'>(initialWorkflowId ? 'workflow' : 'direct')
  const [workspaceStrategy, setWorkspaceStrategy] = useState<WorkspaceStrategy>('isolated_worktree')
  const [branchMode, setBranchMode] = useState<WorktreeCreateMode>('new')
  const [newBranchName, setNewBranchName] = useState(initialBranch)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [selectedExistingBranch, setSelectedExistingBranch] = useState('')
  const [selectedBaseBranch, setSelectedBaseBranch] = useState(lockedBaseBranch ?? '')
  const [multiAgentMode, setMultiAgentModeState] = useState(localStorage.getItem(MULTI_AGENT_STORAGE_KEY) === 'true')
  const [transport, setTransport] = useState<AgentTransport>('native')
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('interactive')
  const [selectedAgentIds, setSelectedAgentIds] = useState<AgentId[]>(loadSavedAgentIds)
  const [profile, setProfile] = useState(savedProfile ?? '')
  const [createLinearTicket, setCreateLinearTicket] = useState(false)
  const [linearTitle, setLinearTitle] = useState('')
  const [linearTeamKey, setLinearTeamKey] = useState(localStorage.getItem(LINEAR_TEAM_KEY_STORAGE_KEY) ?? '')
  const [saveDefault, setSaveDefault] = useState(
    savedProfile !== null ||
      localStorage.getItem(AGENT_STORAGE_KEY) !== null ||
      localStorage.getItem(MULTI_AGENT_STORAGE_KEY) !== null ||
      savedEnvs !== null,
  )
  const [envValues, setEnvValues] = useState(() => loadSavedEnvs(startupEnvs))
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'createDialog' })
  const { t: tc } = useTranslation('common')
  const directFormId = useId()
  const workflowFormId = useId()
  const [workflowReady, setWorkflowReady] = useState(false)
  const handleWorkflowReady = useCallback((ready: boolean) => setWorkflowReady(ready), [])
  const fallbackProfile = defaultProfileName || profiles[0]?.name || 'default'
  const fallbackAgentId = agents.some((agent) => agent.id === defaultAgentId) ? defaultAgentId : (agents[0]?.id ?? '')
  const creatingMultipleAgents = multiAgentMode && selectedAgentIds.length > 1
  const showLinearTicketOption = linearCreateTicketOption && !openedFromLinearIssue && branchMode === 'new'
  const promptRequired = showLinearTicketOption && createLinearTicket
  const linearTeamKeyTrimmed = linearTeamKey.trim().toUpperCase()
  const linearTeamKeyParsed = linearTeamKeyTrimmed ? parseLinearTarget(linearTeamKeyTrimmed) : null
  const linearTeamKeyLooksLikeIssue = linearTeamKeyParsed?.kind === 'issue'
  const linearTeamKeyValid = linearTeamKeyParsed?.kind === 'team'
  const branchPreview =
    branchMode === 'new' && !createLinearTicket && creatingMultipleAgents && newBranchName.trim()
      ? selectedAgentIds.map((agentId) => `${agentId}-${newBranchName.trim()}`)
      : []
  const canSubmit =
    selectedAgentIds.length > 0 &&
    (workspaceStrategy !== 'isolated_worktree' || branchMode === 'new' || selectedExistingBranch.length > 0) &&
    (!promptRequired || prompt.trim().length > 0) &&
    (!createLinearTicket || linearTeamKeyValid)

  useEffect(() => {
    if (!profiles.some((option) => option.name === profile)) setProfile(fallbackProfile)
  }, [fallbackProfile, profile, profiles])

  useEffect(() => {
    const validAgentIds = new Set(agents.map((agent) => agent.id))
    const filtered = selectedAgentIds.filter((agentId) => validAgentIds.has(agentId))
    const next =
      filtered.length > 0
        ? filtered
        : validAgentIds.has(fallbackAgentId)
          ? [fallbackAgentId]
          : agents[0]
            ? [agents[0].id]
            : []
    const normalized = multiAgentMode ? next : next.slice(0, 1)
    if (normalized.length !== selectedAgentIds.length || normalized.some((id, index) => id !== selectedAgentIds[index]))
      setSelectedAgentIds(normalized)
  }, [agents, fallbackAgentId, multiAgentMode, selectedAgentIds])

  useEffect(() => {
    if (!showLinearTicketOption) {
      setCreateLinearTicket(false)
      setLinearTitle('')
    }
  }, [showLinearTicketOption])

  useEffect(() => {
    if (creatingMultipleAgents && branchMode === 'existing') {
      setBranchMode('new')
      setSelectedExistingBranch('')
    }
  }, [branchMode, creatingMultipleAgents])

  useEffect(() => {
    if (workspaceStrategy !== 'isolated_worktree' && multiAgentMode) setMultiAgentModeState(false)
  }, [multiAgentMode, workspaceStrategy])

  function setMultiAgentMode(enabled: boolean): void {
    setMultiAgentModeState(enabled)
    if (!enabled) setSelectedAgentIds((current) => current.slice(0, 1))
  }

  function toggleAgent(agentId: AgentId): void {
    setSelectedAgentIds((current) => {
      if (!multiAgentMode) return [agentId]
      if (current.includes(agentId)) return current.length === 1 ? current : current.filter((id) => id !== agentId)
      return [...current, agentId]
    })
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!canSubmit) return
    if (saveDefault) {
      localStorage.setItem(STORAGE_KEY, profile)
      localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(selectedAgentIds))
      localStorage.setItem(MULTI_AGENT_STORAGE_KEY, String(multiAgentMode))
      localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(envValues))
    } else {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(AGENT_STORAGE_KEY)
      localStorage.removeItem(MULTI_AGENT_STORAGE_KEY)
      localStorage.removeItem(ENV_STORAGE_KEY)
    }
    const filteredEnvs: Record<string, string> = {}
    for (const [key, value] of Object.entries(envValues)) {
      if (typeof value === 'boolean' && value) filteredEnvs[key] = 'true'
      else if (typeof value === 'string' && value) filteredEnvs[key] = value
    }
    const trimmedPrompt = prompt.trim()
    if (createLinearTicket && linearTeamKeyValid)
      localStorage.setItem(LINEAR_TEAM_KEY_STORAGE_KEY, linearTeamKeyTrimmed)
    if (workspaceStrategy !== 'isolated_worktree' || transport === 'acp') {
      const workspace: CreateRunRequest['workspace'] =
        workspaceStrategy === 'current_branch'
          ? { strategy: 'current_branch' }
          : {
              strategy: workspaceStrategy,
              ...(branchMode === 'existing' ? { branch: selectedExistingBranch, existingBranch: true } : {}),
              ...(branchMode === 'new' && newBranchName.trim() ? { branch: newBranchName.trim() } : {}),
              ...(selectedBaseBranch ? { baseBranch: selectedBaseBranch } : {}),
            }
      onRunCreate({
        mode: 'direct',
        harness: selectedAgentIds[0] ?? defaultAgentId,
        input: trimmedPrompt,
        workspace,
        profile,
        idempotencyKey: crypto.randomUUID(),
        transport,
        permissionMode,
        mcpServers: [],
      })
      return
    }
    const branchName = branchMode === 'existing' ? selectedExistingBranch : newBranchName.trim()
    onCreate({
      mode: branchMode,
      ...(branchName && !(branchMode === 'new' && createLinearTicket) ? { branch: branchName } : {}),
      ...(branchMode === 'new' && selectedBaseBranch ? { baseBranch: selectedBaseBranch } : {}),
      profile,
      agents: [...selectedAgentIds],
      ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
      ...(Object.keys(filteredEnvs).length > 0 ? { envOverrides: filteredEnvs } : {}),
      ...(createLinearTicket ? { createLinearTicket: true, linearTeamKey: linearTeamKeyTrimmed } : {}),
      ...(createLinearTicket && linearTitle.trim() ? { linearTitle: linearTitle.trim() } : {}),
    })
  }

  function promptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const modeCard = (active: boolean): string =>
    cn(
      'rounded-md border p-3 text-left transition-colors duration-100 focus-ring',
      active ? 'border-accent bg-selection' : 'border-line bg-surface hover:bg-fill',
    )
  const choiceCard = (active: boolean): string =>
    cn(
      'flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm transition-colors duration-100',
      active ? 'border-accent bg-selection' : 'border-line hover:bg-fill',
    )
  const linkClass = 'mt-2 text-2xs text-accent hover:underline focus-ring rounded-xs'

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      size="lg"
      title={t('title')}
      description={t('description')}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          {runMode === 'workflow' ? (
            <Button size="sm" variant="primary" type="submit" form={workflowFormId} disabled={!workflowReady}>
              {t('startWorkflow')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" type="submit" form={directFormId} disabled={!canSubmit}>
              {t('create')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label={t('runType')}>
        <button
          type="button"
          role="tab"
          aria-selected={runMode === 'direct'}
          className={modeCard(runMode === 'direct')}
          onClick={() => setRunMode('direct')}
        >
          <span className="block text-sm font-medium text-ink">{t('direct.title')}</span>
          <span className="mt-1 block text-xs leading-5 text-subtle">{t('direct.description')}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={runMode === 'workflow'}
          className={modeCard(runMode === 'workflow')}
          onClick={() => setRunMode('workflow')}
        >
          <span className="block text-sm font-medium text-ink">{t('workflow.title')}</span>
          <span className="mt-1 block text-xs leading-5 text-subtle">{t('workflow.description')}</span>
        </button>
      </div>
      {runMode === 'workflow' ? (
        <WorkflowRunForm
          formId={workflowFormId}
          onReadyChange={handleWorkflowReady}
          workflows={workflows}
          loading={workflowsLoading}
          profiles={profiles}
          defaultProfileName={defaultProfileName}
          baseBranches={baseBranches}
          workspaceContext={workspaceContext}
          initialWorkflowId={initialWorkflowId}
          onCreate={onRunCreate}
          onCancel={onCancel}
        />
      ) : (
        <form id={directFormId} onSubmit={submit}>
          <Field
            className="mb-4"
            label={
              <>
                {t('prompt')} <span className="opacity-60">{promptRequired ? t('required') : t('optional')}</span>
              </>
            }
            id="wt-prompt"
          >
            <Textarea
              autoFocus
              id="wt-prompt"
              rows={4}
              className="resize-y"
              placeholder={createLinearTicket ? t('promptPlaceholderLinear') : t('promptPlaceholder')}
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={promptKeyDown}
            />
          </Field>
          <WorkspaceStrategySelector
            value={workspaceStrategy}
            onChange={setWorkspaceStrategy}
            currentBranch={workspaceContext?.branch ?? null}
            policy={{ ...workspacePolicy, reason: t('workspaceReason') }}
          />
          {workspaceStrategy !== 'current_branch' ? (
            <div className="mt-4 mb-4">
              {branchMode === 'new' ? (
                <>
                  <Field
                    label={
                      <>
                        {t('branchName')} <span className="opacity-60">{t('optional')}</span>
                      </>
                    }
                    id="wt-name"
                  >
                    <Input
                      id="wt-name"
                      type="text"
                      placeholder={
                        createLinearTicket
                          ? t('branchPlaceholderLinear')
                          : autoNameEnabled
                            ? t('branchPlaceholderPrompt')
                            : t('branchPlaceholderAuto')
                      }
                      disabled={createLinearTicket}
                      value={newBranchName}
                      onChange={(event) => setNewBranchName(event.currentTarget.value)}
                    />
                  </Field>
                  {createLinearTicket ? (
                    <p className="mt-2 text-2xs text-subtle">{t('linearBranchHint')}</p>
                  ) : creatingMultipleAgents ? (
                    <div className="mt-2 text-2xs text-subtle">
                      <p>{t('multiAgentBranchHint')}</p>
                      {branchPreview.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 font-mono text-2xs text-muted">
                          {branchPreview.map((branch) => (
                            <li key={branch}>{branch}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : workspaceStrategy === 'isolated_worktree' ? (
                    <button
                      type="button"
                      className={linkClass}
                      onClick={() => {
                        setBranchMode('existing')
                        if (!selectedExistingBranch && initialBranch.trim())
                          setSelectedExistingBranch(initialBranch.trim())
                      }}
                    >
                      {t('useExistingBranch')}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <BranchSelector
                    label={t('existingBranch')}
                    selected={selectedExistingBranch}
                    branches={availableBranches}
                    loading={availableBranchesLoading}
                    error={availableBranchesError}
                    initialOpen
                    inlineToggleLabel={t('includeRemote')}
                    inlineToggleAriaLabel={t('includeRemoteBranches')}
                    inlineToggleChecked={includeRemoteBranches}
                    onInlineToggle={() => onIncludeRemoteBranchesChange(!includeRemoteBranches)}
                    onSelect={setSelectedExistingBranch}
                  />
                  <button type="button" className={linkClass} onClick={() => setBranchMode('new')}>
                    {t('createNewBranchInstead')}
                  </button>
                  <p className="mt-2 text-2xs text-subtle">{t('existingBranchRemovalHint')}</p>
                </>
              )}
            </div>
          ) : null}
          {workspaceStrategy !== 'current_branch' && branchMode === 'new' ? (
            <div className="mb-4">
              <BranchSelector
                label={t('baseBranch')}
                selected={selectedBaseBranch}
                branches={baseBranches}
                loading={baseBranchesLoading}
                error={baseBranchesError}
                placeholder={t('baseBranchPlaceholder')}
                disabled={lockedBaseBranch !== null}
                onSelect={setSelectedBaseBranch}
              />
              {lockedBaseBranch !== null ? (
                <p className="mt-2 text-2xs text-subtle">
                  {t('subworktreeBase')} <span className="font-mono">{lockedBaseBranch}</span>
                </p>
              ) : selectedBaseBranch ? (
                <button type="button" className={linkClass} onClick={() => setSelectedBaseBranch('')}>
                  {t('useDefaultBase')}
                </button>
              ) : null}
            </div>
          ) : null}
          {workspaceStrategy === 'new_branch' && workspaceContext?.dirty ? (
            <p className="mb-4 text-xs text-warn">{t('dirtyCheckout', { app: APP_NAME })}</p>
          ) : null}
          <StartupEnvFields startupEnvs={startupEnvs} envValues={envValues} onChange={setEnvValues} />
          <AgentTransportFields
            transport={transport}
            permissionMode={permissionMode}
            onTransportChange={(next) => {
              setTransport(next)
              if (next === 'acp') setMultiAgentMode(false)
            }}
            onPermissionModeChange={setPermissionMode}
          />
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">
                {multiAgentMode ? t('agentsSelected', { count: selectedAgentIds.length }) : t('agent')}
              </span>
              <div className="flex items-center gap-2 text-2xs text-subtle">
                <span>{t('multipleSelection')}</span>
                <Switch
                  size="sm"
                  checked={multiAgentMode}
                  disabled={workspaceStrategy !== 'isolated_worktree'}
                  onCheckedChange={setMultiAgentMode}
                  aria-label={t('enableMultipleAgents')}
                />
              </div>
            </div>
            {creatingMultipleAgents ? (
              <p className="mb-2 text-2xs text-subtle">{t('onePerAgent')}</p>
            ) : workspaceStrategy !== 'isolated_worktree' ? (
              <p className="mb-2 text-2xs text-subtle">{t('multipleNeedIsolated')}</p>
            ) : null}
            {agents.length === 0 ? (
              <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-subtle">{t('noAgents')}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {agents.map((agent) => (
                  <label className={choiceCard(selectedAgentIds.includes(agent.id))} key={agent.id}>
                    <input
                      type={multiAgentMode ? 'checkbox' : 'radio'}
                      name={multiAgentMode ? undefined : 'agent'}
                      checked={selectedAgentIds.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                      className="accent-accent"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{agent.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {profiles.length > 1 ? (
            <div className="mb-5 flex flex-col gap-2">
              {profiles.map((option) => (
                <label className={choiceCard(profile === option.name)} key={option.name}>
                  <input
                    type="radio"
                    name="profile"
                    value={option.name}
                    checked={profile === option.name}
                    onChange={() => setProfile(option.name)}
                    className="accent-accent"
                  />
                  {option.name}
                </label>
              ))}
            </div>
          ) : null}
          <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-muted">
            <Checkbox checked={saveDefault} onChange={(event) => setSaveDefault(event.currentTarget.checked)} />
            {t('saveDefault')}
          </label>
          {showLinearTicketOption ? (
            <div className="rounded-md border border-line bg-surface-2/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-ink">{t('linear.create')}</p>
                  <p className="mt-1 text-2xs text-subtle">{t('linear.createHint')}</p>
                </div>
                <Switch
                  checked={createLinearTicket}
                  onCheckedChange={setCreateLinearTicket}
                  aria-label={t('linear.create')}
                />
              </div>
              {createLinearTicket ? (
                <div className="mt-3 space-y-3">
                  <Field
                    label={t('linear.teamKey')}
                    id="wt-linear-team-key"
                    error={
                      linearTeamKeyTrimmed && linearTeamKeyLooksLikeIssue
                        ? t('linear.looksLikeIssue')
                        : linearTeamKeyTrimmed && !linearTeamKeyValid
                          ? t('linear.invalidTeamKey')
                          : undefined
                    }
                  >
                    <Input
                      id="wt-linear-team-key"
                      type="text"
                      mono
                      className="uppercase"
                      placeholder="ENG"
                      value={linearTeamKey}
                      onChange={(event) => setLinearTeamKey(event.currentTarget.value.toUpperCase())}
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label={
                      <>
                        {t('linear.title')} <span className="opacity-60">{t('optional')}</span>
                      </>
                    }
                    id="wt-linear-title"
                  >
                    <Input
                      id="wt-linear-title"
                      type="text"
                      placeholder={t('linear.titlePlaceholder')}
                      value={linearTitle}
                      onChange={(event) => setLinearTitle(event.currentTarget.value)}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      )}
    </Dialog>
  )
}
