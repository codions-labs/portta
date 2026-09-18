'use client'

import { useQueryClient } from '@tanstack/react-query'
import { APP_NAME, CLI_NAME, LINEAR_IDENTITY } from 'portta-core/taskflow/config'
import { type ReactNode, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CodeChip, Mono } from '@/components/copy'
import { ErrorBox, KeyValue } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Switch } from '@/components/ui/switch'
import { useTaskflowCan, useTaskflowProject } from '../../lib/project.tsx'
import { useAgents } from '../../lib/queries/agents.ts'
import { useAutoNameConfig, useProjectSnapshot } from '../../lib/queries/config.ts'
import type { AgentDetails, AgentSummary, UpsertCustomAgentRequest } from '../../lib/types.ts'
import { errorMessage } from '../../lib/utils.ts'
import { AgentEditorDialog } from '../agents/agent-editor-dialog.tsx'
import { BrowserPreferences } from './browser-preferences.tsx'
import { DiagnosticsPanel } from './diagnostics-panel.tsx'

interface AgentEditorState {
  mode: 'create' | 'edit'
  agentId?: string
  title: string
  initialValue: { label: string; startCommand: string; resumeCommand: string }
}

interface SettingsViewProps {
  linearAutoCreate: boolean
  autoRemoveOnMerge: boolean
  multiplexer: 'tmux' | 'herdr'
  onWebChatUiChange: (enabled: boolean) => void
  onLinearAutoCreateChange: (enabled: boolean) => void
  onAutoRemoveChange: (enabled: boolean) => void
  onAgentsChange: (agents: AgentSummary[]) => void
}

/** A Taskflow Project's settings: what it is, its agents, its integrations, its readiness, and this browser. */
export function SettingsView(props: SettingsViewProps) {
  const {
    linearAutoCreate,
    autoRemoveOnMerge,
    multiplexer,
    onWebChatUiChange,
    onLinearAutoCreateChange,
    onAutoRemoveChange,
    onAgentsChange,
  } = props
  const { t } = useTranslation('taskflow', { keyPrefix: 'settings' })
  const { t: tc } = useTranslation('common')
  const { api, keys, prefix } = useTaskflowProject()
  const canWriteAgents = useTaskflowCan('agent:write')
  const canWriteLinear = useTaskflowCan('linear:write')
  const canWriteWorktrees = useTaskflowCan('worktree:write')
  const canReadWorkspace = useTaskflowCan('workspace:read')
  const snapshot = useProjectSnapshot()
  const autoName = useAutoNameConfig()
  const [pendingAutoCreate, setPendingAutoCreate] = useState<boolean | null>(null)
  const [autoCreateSaving, setAutoCreateSaving] = useState(false)
  const [pendingAutoRemove, setPendingAutoRemove] = useState<boolean | null>(null)
  const [autoRemoveSaving, setAutoRemoveSaving] = useState(false)
  const queryClient = useQueryClient()
  const agentsQuery = useAgents()
  const agents = agentsQuery.data ?? []
  const agentsLoading = agentsQuery.isPending
  const agentsError = agentsQuery.error ? errorMessage(agentsQuery.error) : null
  const [editor, setEditor] = useState<AgentEditorState | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<AgentDetails | null>(null)
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const customAgents = agents.filter((agent) => agent.kind === 'custom')
  const autoCreate = pendingAutoCreate ?? linearAutoCreate
  const autoRemove = pendingAutoRemove ?? autoRemoveOnMerge

  const loadAgentList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: keys.agents() }),
    [keys, queryClient],
  )

  function syncAgentSummaries(): void {
    void api
      .fetchConfig()
      .then((config) => onAgentsChange(config.agents))
      .catch(() => {})
  }

  function handleAutoCreateToggle(enabled: boolean): void {
    setPendingAutoCreate(enabled)
    setAutoCreateSaving(true)
    void api
      .setLinearAutoCreate(enabled)
      .then(onLinearAutoCreateChange)
      .finally(() => {
        setPendingAutoCreate(null)
        setAutoCreateSaving(false)
      })
  }

  function handleAutoRemoveToggle(enabled: boolean): void {
    setPendingAutoRemove(enabled)
    setAutoRemoveSaving(true)
    void api
      .setAutoRemoveOnMerge(enabled)
      .then(onAutoRemoveChange)
      .finally(() => {
        setPendingAutoRemove(null)
        setAutoRemoveSaving(false)
      })
  }

  async function handleSaveAgent(input: UpsertCustomAgentRequest): Promise<void> {
    if (!editor) return
    if (editor.mode === 'edit' && editor.agentId) await api.updateAgent(editor.agentId, input)
    else await api.createAgent(input)
    await loadAgentList()
    syncAgentSummaries()
    setEditor(null)
  }

  async function handleDeleteAgent(): Promise<void> {
    if (!deleteCandidate) return
    setDeletingAgentId(deleteCandidate.id)
    try {
      await api.deleteAgent(deleteCandidate.id)
      await loadAgentList()
      syncAgentSummaries()
      setDeleteCandidate(null)
    } finally {
      setDeletingAgentId(null)
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6">
          <header>
            <h2 className="text-lg font-semibold text-ink">{t('title')}</h2>
            <p className="mt-0.5 text-sm text-subtle">{t('description')}</p>
          </header>
          <SettingsSection title={t('project.title')}>
            {snapshot.error ? (
              <ErrorBox error={snapshot.error} />
            ) : (
              <dl className="flex flex-col">
                <KeyValue label={t('project.prefix')}>
                  <CodeChip>{prefix}</CodeChip>
                </KeyValue>
                <KeyValue label={t('project.name')}>{snapshot.data?.project.name ?? '…'}</KeyValue>
                <KeyValue label={t('project.mainBranch')}>
                  <Mono kind="branch">{snapshot.data?.project.mainBranch ?? '…'}</Mono>
                </KeyValue>
                <KeyValue label={t('project.worktrees')}>{snapshot.data?.worktrees.length ?? '…'}</KeyValue>
                <KeyValue label={t('autoName.title')}>
                  {autoName.data?.autoName
                    ? [
                        t('autoName.provider', { provider: autoName.data.autoName.provider }),
                        autoName.data.autoName.model
                          ? t('autoName.model', { model: autoName.data.autoName.model })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : autoName.data
                      ? t('autoName.off')
                      : autoName.error
                        ? '—'
                        : '…'}
                </KeyValue>
              </dl>
            )}
          </SettingsSection>
          <SettingsSection title={t('interface.title')}>
            <BrowserPreferences onWebChatUiChange={onWebChatUiChange} />
          </SettingsSection>
          <SettingsSection
            title={t('agents.title')}
            actions={
              canWriteAgents ? (
                <Button
                  size="xs"
                  variant="primary"
                  onClick={() =>
                    setEditor({
                      mode: 'create',
                      title: t('agents.addTitle'),
                      initialValue: { label: '', startCommand: '', resumeCommand: '' },
                    })
                  }
                >
                  {t('agents.add')}
                </Button>
              ) : undefined
            }
          >
            <p className="mb-3 text-xs text-subtle">{t('agents.description', { app: APP_NAME })}</p>
            {agentsLoading ? (
              <p className="text-xs text-subtle">{t('agents.loading')}</p>
            ) : agentsError ? (
              <ErrorBox error={agentsError} />
            ) : customAgents.length === 0 ? (
              <p className="text-xs text-subtle">{t('agents.empty')}</p>
            ) : (
              <div className="space-y-2">
                {customAgents.map((agent) => (
                  <div className="rounded-md border border-line bg-surface px-3 py-2.5" key={agent.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-ink">{agent.label}</span>
                        <p className="mt-1 break-all font-mono text-2xs text-subtle">{agent.startCommand}</p>
                        {agent.resumeCommand ? (
                          <p className="mt-1 break-all font-mono text-2xs text-subtle">
                            {t('agents.resume', { command: agent.resumeCommand })}
                          </p>
                        ) : null}
                      </div>
                      {canWriteAgents ? (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setEditor({
                                mode: 'edit',
                                agentId: agent.id,
                                title: t('agents.edit', { name: agent.label }),
                                initialValue: {
                                  label: agent.label,
                                  startCommand: agent.startCommand ?? '',
                                  resumeCommand: agent.resumeCommand ?? '',
                                },
                              })
                            }
                          >
                            {t('agents.editAction')}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setEditor({
                                mode: 'create',
                                title: t('agents.duplicate', { name: agent.label }),
                                initialValue: {
                                  label: t('agents.copyName', { name: agent.label }),
                                  startCommand: agent.startCommand ?? '',
                                  resumeCommand: agent.resumeCommand ?? '',
                                },
                              })
                            }
                          >
                            {t('agents.duplicateAction')}
                          </Button>
                          <Button
                            size="xs"
                            variant="danger"
                            disabled={deletingAgentId === agent.id}
                            onClick={() => setDeleteCandidate(agent)}
                          >
                            {tc('delete')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>
          <SettingsSection title={t('linear.title')}>
            <SettingRow
              title={t('linear.autoCreate')}
              hint={t('linear.autoCreateHint', { label: LINEAR_IDENTITY.label })}
            >
              <Switch
                checked={autoCreate}
                disabled={autoCreateSaving || !canWriteLinear}
                onCheckedChange={handleAutoCreateToggle}
                aria-label={t('linear.autoCreateLabel')}
              />
            </SettingRow>
          </SettingsSection>
          <SettingsSection title={t('terminal.title')}>
            <SettingRow
              title={t('terminal.multiplexer')}
              hint={
                <>
                  {multiplexer === 'herdr' ? (
                    <Trans t={t} i18nKey="terminal.herdr" components={{ code: <code className="font-mono" /> }} />
                  ) : (
                    t('terminal.tmux')
                  )}{' '}
                  {t('terminal.change')} <code className="font-mono">{CLI_NAME} multiplexer &lt;tmux|herdr&gt;</code>.
                </>
              }
            >
              <span className="shrink-0 text-sm text-ink">{multiplexer}</span>
            </SettingRow>
          </SettingsSection>
          {canReadWorkspace ? (
            <SettingsSection title={t('diagnostics.section')}>
              <DiagnosticsPanel />
            </SettingsSection>
          ) : null}
          <SettingsSection title={t('github.title')}>
            <SettingRow title={t('github.autoRemove')} hint={t('github.autoRemoveHint')}>
              <Switch
                checked={autoRemove}
                disabled={autoRemoveSaving || !canWriteWorktrees}
                onCheckedChange={handleAutoRemoveToggle}
                aria-label={t('github.autoRemoveLabel')}
              />
            </SettingRow>
          </SettingsSection>
        </div>
      </div>
      {editor ? (
        <AgentEditorDialog
          title={editor.title}
          initialValue={editor.initialValue}
          onSave={handleSaveAgent}
          onValidate={api.validateAgent}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null)
        }}
        title={t('agents.deleteTitle')}
        impact={t('agents.deleteImpact', { name: deleteCandidate?.label ?? '' })}
        confirmLabel={tc('remove')}
        busy={deletingAgentId !== null}
        onConfirm={() => void handleDeleteAgent()}
      />
    </>
  )
}

function SettingsSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} actions={actions} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

function SettingRow({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="text-sm text-ink">{title}</span>
        <p className="mt-0.5 text-xs text-subtle">{hint}</p>
      </div>
      {children}
    </div>
  )
}
