'use client'

import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Field, Select } from '@/components/ui/field'
import type { RunListResponse, WorktreeInfo } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { RunStatusBadge } from './run-status-badge.tsx'

type Run = RunListResponse['runs'][number]
type ModeFilter = 'all' | 'direct' | 'workflow'
type StatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled' | 'closed'
type RunsT = TFunction<'taskflow-runs'>

interface RunListProps {
  runs: Run[]
  selectedId?: string | null
  directSessions?: WorktreeInfo[]
  onSelect: (runId: string) => void
  onSelectSession?: (branch: string) => void
}

function isActive(run: Run): boolean {
  return ['queued', 'provisioning', 'running', 'waiting_input', 'interrupted'].includes(run.status)
}

function sessionStatus(
  session: WorktreeInfo,
): 'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'closed' {
  if (session.creating || session.status === 'starting') return 'queued'
  if (session.status === 'running') return 'running'
  if (session.status === 'idle') return 'waiting_input'
  if (session.status === 'stopped') return 'completed'
  if (session.status === 'error') return 'failed'
  return 'closed'
}

function sessionIsActive(session: WorktreeInfo): boolean {
  return session.creating || session.mux === '✓' || ['starting', 'running', 'idle'].includes(session.status)
}

export function formatRunDuration(
  t: RunsT,
  startedAt: string | null,
  completedAt: string | null,
  seconds = false,
): string {
  if (!startedAt) return t('duration.notStarted')
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const total = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000))
  if (total < 60) return `${total}s`
  if (total < 3600) return seconds ? `${Math.floor(total / 60)}m ${total % 60}s` : `${Math.floor(total / 60)}m`
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`
}

export function runTitle(t: RunsT, run: Run): string {
  return run.workflowSnapshot?.name ?? run.workspace?.branch ?? run.harness ?? t('directRun')
}

const rowClass = (selected: boolean): string =>
  cn(
    'w-full border-l-2 px-3 py-3 text-left transition-colors duration-100 focus-ring-inset',
    selected ? 'border-l-accent bg-selection' : 'border-l-transparent hover:bg-fill',
  )

function RunRow({ run, selected, onSelect }: { run: Run; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation('taskflow-runs')
  return (
    <button type="button" className={rowClass(selected)} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <Badge tone="outline" className="uppercase tracking-wide">
          {t(`mode.${run.mode}`)}
        </Badge>
        <RunStatusBadge status={run.status} />
        <span className="ml-auto text-2xs tabular-nums text-subtle">
          {formatRunDuration(t, run.startedAt, run.completedAt)}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink">{runTitle(t, run)}</p>
      <p className="mt-1 truncate text-2xs text-subtle">
        {run.workspace?.branch ??
          (run.mode === 'workflow' ? t('list.workspacePending') : (run.harness ?? t('list.directSession')))}
      </p>
    </button>
  )
}

function SessionRow({ session, onSelect }: { session: WorktreeInfo; onSelect: () => void }) {
  const { t } = useTranslation('taskflow-runs')
  return (
    <button type="button" className={rowClass(false)} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <Badge tone="outline" className="uppercase tracking-wide">
          {t('mode.direct')}
        </Badge>
        <RunStatusBadge status={sessionStatus(session)} />
        <span className="ml-auto text-2xs uppercase tracking-wide text-subtle">{t('list.session')}</span>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink">{session.label ?? session.branch}</p>
      <p className="mt-1 truncate text-2xs text-subtle">
        {session.agentLabel ?? session.agentName ?? t('list.agent')} · {session.profile ?? t('list.defaultProfile')}
      </p>
    </button>
  )
}

interface RunSectionProps {
  title: string
  runs: Run[]
  sessions: WorktreeInfo[]
  selectedId: string | null
  onSelect: (runId: string) => void
  onSelectSession: (branch: string) => void
}

function RunSection({ title, runs, sessions, selectedId, onSelect, onSelectSession }: RunSectionProps) {
  if (runs.length === 0 && sessions.length === 0) return null
  return (
    <section>
      <h2 className="sticky top-0 z-10 flex h-8 items-center border-b border-line bg-surface-2 px-3 text-xs font-medium text-muted">
        {title}
      </h2>
      <ul className="divide-y divide-line">
        {runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} selected={selectedId === run.id} onSelect={() => onSelect(run.id)} />
          </li>
        ))}
        {sessions.map((session) => (
          <li key={session.branch}>
            <SessionRow session={session} onSelect={() => onSelectSession(session.branch)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function modeFilter(value: string): ModeFilter {
  return value === 'direct' || value === 'workflow' ? value : 'all'
}

function statusFilter(value: string): StatusFilter {
  return value === 'active' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'closed'
    ? value
    : 'all'
}

export function RunList({
  runs,
  selectedId = null,
  directSessions = [],
  onSelect,
  onSelectSession = () => {},
}: RunListProps) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'list' })
  const [mode, setMode] = useState<ModeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const filteredRuns = runs.filter((run) => {
    if (mode !== 'all' && run.mode !== mode) return false
    if (status === 'active') return isActive(run)
    if (status === 'closed') return false
    if (status !== 'all') return run.status === status
    return true
  })
  const filteredSessions = directSessions.filter((session) => {
    if (mode === 'workflow') return false
    if (status === 'active') return sessionIsActive(session)
    if (status === 'completed') return sessionStatus(session) === 'completed'
    if (status === 'failed') return sessionStatus(session) === 'failed'
    if (status === 'cancelled') return false
    if (status === 'closed') return sessionStatus(session) === 'closed'
    return true
  })
  const activeRuns = filteredRuns.filter(isActive)
  const historyRuns = filteredRuns.filter((run) => !isActive(run))
  const activeSessions = filteredSessions.filter(sessionIsActive)
  const historySessions = filteredSessions.filter((session) => !sessionIsActive(session))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-2 gap-2 border-b border-line px-3 py-3">
        <Field label={t('type')} id="run-filter-type">
          <Select
            id="run-filter-type"
            size="sm"
            className="w-full"
            value={mode}
            onChange={(event) => setMode(modeFilter(event.currentTarget.value))}
          >
            <option value="all">{t('allRuns')}</option>
            <option value="direct">{t('direct')}</option>
            <option value="workflow">{t('workflow')}</option>
          </Select>
        </Field>
        <Field label={t('statusLabel')} id="run-filter-status">
          <Select
            id="run-filter-status"
            size="sm"
            className="w-full"
            value={status}
            onChange={(event) => setStatus(statusFilter(event.currentTarget.value))}
          >
            <option value="all">{t('allStatuses')}</option>
            <option value="active">{t('active')}</option>
            <option value="completed">{t('completed')}</option>
            <option value="failed">{t('failed')}</option>
            <option value="cancelled">{t('cancelled')}</option>
            <option value="closed">{t('closedSession')}</option>
          </Select>
        </Field>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {filteredRuns.length === 0 && filteredSessions.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs leading-5 text-subtle">{t('empty')}</p>
        ) : null}
        <RunSection
          title={t('activeSection')}
          runs={activeRuns}
          sessions={activeSessions}
          selectedId={selectedId}
          onSelect={onSelect}
          onSelectSession={onSelectSession}
        />
        <RunSection
          title={t('historySection')}
          runs={historyRuns}
          sessions={historySessions}
          selectedId={selectedId}
          onSelect={onSelect}
          onSelectSession={onSelectSession}
        />
      </div>
    </div>
  )
}
