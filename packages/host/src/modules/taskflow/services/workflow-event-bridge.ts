import { join } from 'node:path'
import { type JsonValue, JsonValueSchema } from 'portta-contracts/taskflow'
import type { ExecutionRecord, RunEventRecord, RunRecord } from 'portta-core/taskflow'
import type { RunStore } from '../adapters/run-store.ts'

export interface WorkflowEventPublisher {
  publish(event: RunEventRecord): void
}

export interface WorkflowEventBridgeDependencies {
  store: RunStore
  publisher?: WorkflowEventPublisher
  now?: () => Date
}

export interface WorkflowEventContext {
  engineRunId: string
  dataRoot: string
}

export type WorkflowEventBridgeResult =
  | { ok: true; replayed: boolean; event: RunEventRecord }
  | { ok: false; reason: 'invalid_event' | 'not_found' | 'cursor_regression' | 'run_mismatch' }

interface WorkflowEventDetails {
  type: 'run' | 'phase' | 'agent' | 'log'
  timestamp: string
  payload: JsonValue
  agent?: {
    key: string
    index: number
    label: string
    phase: string | null
    phaseIndex: number | null
    provider: string
    model: string | null
    status: ExecutionRecord['status']
    usage: JsonValue | null
    error: string | null
    startedAt: string | null
    completedAt: string | null
  }
  runStarted: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) output[key] = entry
  return output
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function isoTimestamp(value: unknown, fallback: () => Date): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  return fallback().toISOString()
}

function optionalTimestamp(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null
}

function agentStatus(value: unknown): ExecutionRecord['status'] | null {
  if (value === 'queued' || value === 'running') return 'running'
  if (value === 'done') return 'completed'
  if (value === 'failed') return 'failed'
  if (value === 'skipped') return 'skipped'
  return null
}

function parseWorkflowEvent(value: unknown, now: () => Date): WorkflowEventDetails | null {
  const input = record(value)
  if (!input || typeof input.type !== 'string') return null
  const payload = JsonValueSchema.safeParse(value)
  if (!payload.success) return null
  const timestamp = isoTimestamp(input.t, now)
  if (input.type === 'run') {
    return typeof input.status === 'string'
      ? { type: 'run', timestamp, payload: payload.data, runStarted: input.status === 'started' }
      : null
  }
  if (input.type === 'phase') {
    return integer(input.index) !== null && nonEmptyString(input.title) !== null
      ? { type: 'phase', timestamp, payload: payload.data, runStarted: false }
      : null
  }
  if (input.type === 'log') {
    return nonEmptyString(input.message) !== null
      ? { type: 'log', timestamp, payload: payload.data, runStarted: false }
      : null
  }
  if (input.type !== 'agent') return null
  const index = integer(input.index)
  const label = nonEmptyString(input.label)
  const provider = nonEmptyString(input.provider)
  const status = agentStatus(input.state)
  if (index === null || label === null || provider === null || status === null) return null
  const key = nonEmptyString(input.key) ?? `index:${index}`
  const inputTokens = integer(input.inputTokens)
  const outputTokens = integer(input.outputTokens)
  const costUsd = typeof input.costUsd === 'number' && Number.isFinite(input.costUsd) ? input.costUsd : null
  return {
    type: 'agent',
    timestamp,
    payload: payload.data,
    runStarted: false,
    agent: {
      key,
      index,
      label,
      phase: nonEmptyString(input.phaseTitle),
      phaseIndex: integer(input.phaseIndex),
      provider,
      model: nonEmptyString(input.model),
      status,
      usage:
        inputTokens === null && outputTokens === null && costUsd === null
          ? null
          : { inputTokens, outputTokens, costUsd },
      error: nonEmptyString(input.error),
      startedAt: optionalTimestamp(input.startedAt),
      completedAt: status === 'completed' || status === 'failed' || status === 'skipped' ? timestamp : null,
    },
  }
}

function executionFor(
  run: RunRecord,
  existing: ExecutionRecord | undefined,
  details: NonNullable<WorkflowEventDetails['agent']>,
  context: WorkflowEventContext | undefined,
): ExecutionRecord {
  const nodeKey = `workflow:${details.key}`
  const now = details.startedAt ?? details.completedAt
  return {
    id: existing?.id ?? `execution_${run.id}_${details.key}`,
    runId: run.id,
    nodeKey,
    label: details.label,
    phase: details.phase,
    attempt: existing?.attempt ?? 1,
    harness: 'workflow-engine',
    provider: details.provider,
    model: details.model,
    effectiveConfig: {
      key: details.key,
      index: details.index,
      phaseIndex: details.phaseIndex,
      transcriptPath: context
        ? join(context.dataRoot, 'runs', context.engineRunId, 'agents', `${details.index}.jsonl`)
        : null,
    },
    workspaceId: run.workspaceId,
    input: existing?.input ?? null,
    output: existing?.output ?? null,
    status: details.status,
    usage: details.usage ?? existing?.usage ?? null,
    error: details.error,
    sessionId: null,
    capabilities: null,
    checkpoint: existing?.checkpoint ?? null,
    startedAt: existing?.startedAt ?? details.startedAt ?? now,
    completedAt: details.completedAt,
  }
}

export class WorkflowEventBridge {
  private readonly now: () => Date
  private readonly publisher: WorkflowEventPublisher

  private readonly dependencies: WorkflowEventBridgeDependencies
  constructor(dependencies: WorkflowEventBridgeDependencies) {
    this.dependencies = dependencies
    this.now = dependencies.now ?? (() => new Date())
    this.publisher = dependencies.publisher ?? { publish: (): void => {} }
  }

  apply(runId: string, sequence: number, value: unknown, context?: WorkflowEventContext): WorkflowEventBridgeResult {
    const run = this.dependencies.store.getRun(runId)
    if (run === null) return { ok: false, reason: 'not_found' }
    const details = parseWorkflowEvent(value, this.now)
    if (details === null) return { ok: false, reason: 'invalid_event' }
    const existing = details.agent
      ? this.dependencies.store
          .getExecutions(runId)
          .find((execution) => execution.nodeKey === `workflow:${details.agent?.key}`)
      : undefined
    const execution = details.agent ? executionFor(run, existing, details.agent, context) : undefined
    const event: RunEventRecord = {
      id: `event_${runId}_${sequence}`,
      runId,
      executionId: execution?.id ?? null,
      sessionId: null,
      sequence,
      type: `workflow.${details.type}`,
      timestamp: details.timestamp,
      source: 'workflow',
      payload: { version: 1, data: details.payload },
    }
    const appended = this.dependencies.store.appendEvent({
      event,
      execution,
      cursor: { runId, sequence, source: 'workflow', updatedAt: this.now().toISOString() },
    })
    if (!appended.ok) return appended
    if (details.runStarted && run.status === 'provisioning') {
      this.dependencies.store.transitionRun(runId, 'running', this.now().toISOString(), {
        startedAt: this.now().toISOString(),
      })
    }
    if (!appended.replayed) this.publisher.publish(event)
    return { ok: true, replayed: appended.replayed, event }
  }
}
