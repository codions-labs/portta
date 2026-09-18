'use client'

import Link from 'next/link'
import { issueRefLabel } from 'portta-core/browser'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTaskflowProject } from '../../lib/project.tsx'
import type { RunDetailResponse, RunTimelineState, TranscriptEntry } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { EnvironmentPanel } from '../environments/environment-panel.tsx'
import { ExecutionTranscript } from './execution-transcript.tsx'
import { formatRunDuration, runTitle } from './run-list.tsx'
import { RunStatusBadge } from './run-status-badge.tsx'

type Execution = RunDetailResponse['run']['executions'][number]
type WorkflowPhaseStatus = NonNullable<RunDetailResponse['run']['workflowProgress']>['phases'][number]['status']

interface RunDetailProps {
  detail: RunDetailResponse
  timeline: RunTimelineState
  selectedExecutionId?: string | null
  transcriptEntries?: TranscriptEntry[]
  transcriptLoading?: boolean
  onSelectExecution: (executionId: string) => void
  onCloseExecution: () => void
  onCancel: (runId: string) => void
  onResume: (runId: string) => void
  onRespondPermission: (runId: string, requestId: string, optionId: string | null) => void
  onOpenSession: (branch: string) => void
  /** Which actions this person may take; all of them when absent. The proxy refuses the rest anyway. */
  allowed?: { cancel?: boolean; resume?: boolean; respond?: boolean }
}

function timestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function json(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function eventLabel(type: string): string {
  return type
    .replace(/^workflow\./, '')
    .replaceAll('_', ' ')
    .replaceAll('.', ' · ')
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function pendingPermission(timeline: RunTimelineState): {
  requestId: string
  title: string | null
  options: Array<{ optionId: string; name: string }>
} | null {
  const resolved = new Set(
    timeline.events
      .filter((event) => event.type === 'acp.agent.permission.resolved')
      .flatMap((event) => {
        const requestId = object(object(event.payload.data)?.event)?.requestId
        return typeof requestId === 'string' ? [requestId] : []
      }),
  )
  for (const event of timeline.events.toReversed()) {
    if (event.type !== 'acp.agent.permission') continue
    const envelope = object(object(event.payload.data)?.event)
    const requestId = envelope?.requestId
    if (typeof requestId !== 'string' || resolved.has(requestId)) continue
    const request = object(envelope?.request)
    const toolCall = object(request?.toolCall)
    const options = Array.isArray(request?.options)
      ? request.options.flatMap((candidate) => {
          const option = object(candidate)
          return typeof option?.optionId === 'string' && typeof option.name === 'string'
            ? [{ optionId: option.optionId, name: option.name }]
            : []
        })
      : []
    return {
      requestId,
      title: typeof toolCall?.title === 'string' ? toolCall.title : null,
      options,
    }
  }
  return null
}

export function emptyPhaseMessageKey(status: WorkflowPhaseStatus): 'phaseSkipped' | 'phaseWaiting' {
  return status === 'skipped' ? 'phaseSkipped' : 'phaseWaiting'
}

export function resolvedPhaseCount(statuses: WorkflowPhaseStatus[]): number {
  return statuses.filter((status) => status !== 'pending' && status !== 'running').length
}

const panel = 'rounded-lg border border-line bg-surface'
const sectionTitle = 'text-sm font-semibold text-ink'
const eyebrow = 'text-2xs font-medium text-subtle'

function ExecutionCard({
  execution,
  selected,
  onSelect,
}: {
  execution: Execution
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('taskflow-runs')
  return (
    <button
      type="button"
      className={cn(
        'block w-full bg-surface p-4 text-left transition-colors duration-100 hover:bg-fill focus-ring-inset',
        selected && 'ring-1 ring-inset ring-accent',
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium text-ink">{execution.label}</h4>
          <p className="mt-1 truncate text-2xs text-subtle">
            {execution.provider ?? execution.harness}
            {execution.transport ? ` · ${execution.transport.toUpperCase()}` : ''}
            {execution.model ? ` · ${execution.model}` : ''}
          </p>
        </div>
        <RunStatusBadge status={execution.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-subtle">
        <span>{formatRunDuration(t, execution.startedAt, execution.completedAt, true)}</span>
        {execution.usage.totalTokens !== null ? (
          <span>
            {t('detail.tokens', {
              count: execution.usage.totalTokens,
              formatted: execution.usage.totalTokens.toLocaleString(),
            })}
          </span>
        ) : null}
        {execution.usage.costUsd !== null ? <span>${execution.usage.costUsd.toFixed(4)}</span> : null}
        {execution.observability?.cached ? <span>{t('detail.cached')}</span> : null}
        {execution.observability?.lastTool ? (
          <span>{t('detail.lastTool', { tool: execution.observability.lastTool })}</span>
        ) : null}
      </div>
      {execution.observability?.resultPreview ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{execution.observability.resultPreview}</p>
      ) : null}
      {execution.error ? <p className="mt-2 line-clamp-2 text-xs text-danger">{execution.error}</p> : null}
      <p className="mt-3 text-2xs font-medium text-accent">{t('detail.viewActivity')}</p>
    </button>
  )
}

export function RunDetail({
  detail,
  timeline,
  selectedExecutionId = null,
  transcriptEntries = [],
  transcriptLoading = false,
  onSelectExecution,
  onCloseExecution,
  onCancel,
  onResume,
  onRespondPermission,
  onOpenSession,
  allowed = {},
}: RunDetailProps) {
  const { t } = useTranslation('taskflow-runs')
  const { t: td } = useTranslation('taskflow-runs', { keyPrefix: 'detail' })
  const { t: tc } = useTranslation('common')
  const { slug } = useTaskflowProject()
  const run = detail.run
  const permission = pendingPermission(timeline)
  const selectedExecution = run.executions.find((execution) => execution.id === selectedExecutionId) ?? null
  const executionById = new Map(run.executions.map((execution) => [execution.id, execution]))
  const executionCard = (execution: Execution) => (
    <ExecutionCard
      key={execution.id}
      execution={execution}
      selected={selectedExecutionId === execution.id}
      onSelect={() => onSelectExecution(execution.id)}
    />
  )
  const facts: Array<{ label: string; value: string; title?: string; numeric?: boolean; href?: string }> = [
    { label: td('workflow'), value: run.workflowSnapshot?.name ?? td('directWorkflow') },
    ...(run.issueRef
      ? [
          {
            label: td('issue'),
            value: issueRefLabel(run.issueRef),
            href: `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(run.issueRef)}`,
          },
        ]
      : []),
    { label: td('started'), value: timestamp(run.startedAt), title: run.startedAt ?? '' },
    { label: td('duration'), value: formatRunDuration(t, run.startedAt, run.completedAt, true), numeric: true },
    { label: td('branch'), value: run.workspace?.branch ?? '—', title: run.workspace?.branch ?? '' },
    {
      label: td('workspace'),
      value: run.workspace ? t(`strategy.${run.workspace.strategy}`) : '—',
      title: run.workspace?.path ?? '',
    },
    { label: td('profile'), value: run.profile ?? td('defaultProfile') },
  ]

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
      <section className="min-w-0 flex-1 overflow-y-auto scroll-thin">
        <header className="border-b border-line px-5 py-4 md:px-7">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone="outline" className="uppercase tracking-wide">
                  {t(`mode.${run.mode}`)}
                </Badge>
                <RunStatusBadge status={run.status} />
              </div>
              <h1 className="truncate text-xl font-semibold text-ink">{runTitle(t, run)}</h1>
              {run.workflowSnapshot ? (
                <p className="mt-1 text-xs text-subtle">{run.workflowSnapshot.description}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              {run.workspace?.branch ? (
                <Button size="sm" onClick={() => onOpenSession(run.workspace?.branch ?? '')}>
                  {td('openSession')}
                </Button>
              ) : null}
              {run.capabilities.resume && allowed.resume !== false ? (
                <Button size="sm" variant="primary" onClick={() => onResume(run.id)}>
                  {td('resume')}
                </Button>
              ) : null}
              {run.capabilities.cancel && allowed.cancel !== false ? (
                <Button size="sm" variant="danger" onClick={() => onCancel(run.id)}>
                  {tc('cancel')}
                </Button>
              ) : null}
            </div>
          </div>
        </header>
        <div className="space-y-6 p-5 md:p-7">
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
            {facts.map((fact) => (
              <div className="bg-surface p-3" key={fact.label}>
                <p className={eyebrow}>{fact.label}</p>
                {fact.href ? (
                  <Link
                    className="mt-1 block truncate text-xs text-accent underline-offset-2 hover:underline focus-ring"
                    href={fact.href}
                    title={fact.title}
                  >
                    {fact.value}
                  </Link>
                ) : (
                  <p
                    className={cn('mt-1 truncate text-xs text-ink', fact.numeric && 'tabular-nums')}
                    title={fact.title}
                  >
                    {fact.value}
                  </p>
                )}
              </div>
            ))}
          </section>
          {run.error ? (
            <section className="rounded-lg border border-danger/35 bg-danger/6 p-4">
              <h2 className="text-xs font-semibold text-danger">{td('runError')}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-danger">{run.error}</p>
            </section>
          ) : null}
          {run.status === 'waiting_input' && permission ? (
            <section className="rounded-lg border border-accent/35 bg-accent/6 p-4">
              <h2 className="text-xs font-semibold text-accent">{td('needsApproval')}</h2>
              <p className="mt-2 text-sm text-ink">{permission.title ?? td('permissionFallback')}</p>
              {allowed.respond !== false ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {permission.options.map((option) => (
                    <Button
                      key={option.optionId}
                      size="sm"
                      variant="primary"
                      onClick={() => onRespondPermission(run.id, permission.requestId, option.optionId)}
                    >
                      {option.name}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onRespondPermission(run.id, permission.requestId, null)}
                  >
                    {td('deny')}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
          {run.mode === 'workflow' && run.workflowProgress ? (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className={sectionTitle}>{td('progress')}</h2>
                  <p className="mt-1 text-xs text-subtle">{td('progressHint')}</p>
                </div>
                <span className="text-xs text-subtle">
                  {td('phaseCount', {
                    resolved: resolvedPhaseCount(run.workflowProgress.phases.map((phase) => phase.status)),
                    total: run.workflowProgress.phases.length,
                  })}
                </span>
              </div>
              <div className="space-y-3">
                {run.workflowProgress.phases.map((phase, phasePosition) => {
                  const executions = phase.executionIds.flatMap((executionId) => {
                    const execution = executionById.get(executionId)
                    return execution ? [execution] : []
                  })
                  return (
                    <article className={cn(panel, 'overflow-hidden')} key={phase.index}>
                      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-2xs font-semibold text-subtle">
                          {phasePosition + 1}
                        </span>
                        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{phase.title}</h3>
                        <RunStatusBadge status={phase.status} />
                      </header>
                      {executions.length > 0 ? (
                        <div className={cn('grid gap-px bg-line', executions.length > 1 && 'md:grid-cols-2')}>
                          {executions.map(executionCard)}
                        </div>
                      ) : (
                        <p className="px-4 py-3 text-xs text-subtle">{td(emptyPhaseMessageKey(phase.status))}</p>
                      )}
                    </article>
                  )
                })}
                {run.workflowProgress.ungroupedExecutionIds.length > 0 ? (
                  <article className={cn(panel, 'overflow-hidden')}>
                    <header className="border-b border-line px-4 py-3">
                      <h3 className="text-sm font-medium text-ink">{td('additionalExecutions')}</h3>
                    </header>
                    <div className="grid gap-px bg-line md:grid-cols-2">
                      {run.workflowProgress.ungroupedExecutionIds.flatMap((id) => {
                        const execution = executionById.get(id)
                        return execution ? [executionCard(execution)] : []
                      })}
                    </div>
                  </article>
                ) : null}
              </div>
            </section>
          ) : (
            <section>
              <h2 className={cn(sectionTitle, 'mb-3')}>{td('executions')}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {run.executions.length > 0 ? (
                  run.executions.map((execution) => (
                    <div className={cn(panel, 'overflow-hidden')} key={execution.id}>
                      {executionCard(execution)}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-subtle">{td('waitingFirstExecution')}</p>
                )}
              </div>
            </section>
          )}
          <section className="grid gap-5 lg:grid-cols-2">
            <div>
              <h2 className={cn(sectionTitle, 'mb-2')}>{td('input')}</h2>
              <pre className={cn(panel, 'max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-ink')}>
                {json(run.input)}
              </pre>
            </div>
            <div>
              <h2 className={cn(sectionTitle, 'mb-2')}>{td('result')}</h2>
              {run.result !== null ? (
                <pre className={cn(panel, 'max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-ink')}>
                  {json(run.result)}
                </pre>
              ) : (
                <p className={cn(panel, 'p-3 text-xs text-subtle')}>{td('noResult')}</p>
              )}
            </div>
          </section>
          {run.environmentId ? <EnvironmentPanel environmentId={run.environmentId} interfaceMode="web_chat" /> : null}
          {run.artifacts.length > 0 ? (
            <section>
              <h2 className={cn(sectionTitle, 'mb-2')}>{td('artifacts')}</h2>
              <div className={cn(panel, 'divide-y divide-line overflow-hidden')}>
                {run.artifacts.map((artifact) => (
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 text-xs"
                    key={`${artifact.kind}:${artifact.label}`}
                  >
                    <Badge tone="outline" className="uppercase tracking-wide">
                      {artifact.kind}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-ink">{artifact.label}</span>
                    {artifact.executionId ? (
                      <Button size="xs" variant="link" onClick={() => onSelectExecution(artifact.executionId ?? '')}>
                        {td('viewArtifactActivity')}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section>
            <h2 className={cn(sectionTitle, 'mb-2')}>{td('events')}</h2>
            {timeline.events.length === 0 ? (
              <p className={cn(panel, 'p-3 text-xs text-subtle')}>{td('noEvents')}</p>
            ) : (
              <ol className={cn(panel, 'divide-y divide-line overflow-hidden')}>
                {timeline.events.toReversed().map((event) => (
                  <li className="px-3 py-2.5 text-xs" key={event.sequence}>
                    <div className="flex items-center gap-2">
                      <strong className="font-medium text-ink">{eventLabel(event.type)}</strong>
                      <span className="ml-auto tabular-nums text-subtle">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <details className="mt-1 text-subtle">
                      <summary className="cursor-pointer text-2xs">{td('structuredPayload')}</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono">
                        {json(event.payload.data)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </section>
      {selectedExecution ? (
        <>
          <div className="hidden w-[min(42%,34rem)] shrink-0 lg:flex">
            <ExecutionTranscript
              execution={selectedExecution}
              entries={transcriptEntries}
              loading={transcriptLoading}
              onClose={onCloseExecution}
            />
          </div>
          <div className="fixed inset-0 z-40 flex bg-surface lg:hidden">
            <ExecutionTranscript
              execution={selectedExecution}
              entries={transcriptEntries}
              loading={transcriptLoading}
              onClose={onCloseExecution}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
