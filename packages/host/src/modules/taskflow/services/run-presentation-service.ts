import {
  RunDetailResponseSchema,
  RunEventsResponseSchema,
  RunListResponseSchema,
  WorkflowListResponseSchema,
} from 'portta-contracts/taskflow'
import type { ExecutionRecord, RunEventRecord, RunRecord, WorkflowSnapshotRecord } from 'portta-core/taskflow'
import type { RunStore } from '../adapters/run-store.ts'
import type { WorkflowCatalogEntry, WorkflowCatalogService } from './workflow-catalog-service.ts'

function object(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) output[key] = entry
  return output
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function executionUsage(value: unknown): {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  costUsd: number | null
} {
  const input = object(value)
  const inputTokens = numberOrNull(input?.inputTokens)
  const outputTokens = numberOrNull(input?.outputTokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
    costUsd: numberOrNull(input?.costUsd),
  }
}

function sessionCapabilities(
  value: unknown,
): { terminal: boolean; interactiveInput: boolean; interrupt: boolean; resume: boolean } | null {
  const input = object(value)
  if (!input) return null
  return {
    terminal: input.terminal === true,
    interactiveInput: input.interactiveInput === true,
    interrupt: input.interrupt === true,
    resume: input.resume === true,
  }
}

function presentSnapshot(snapshot: WorkflowSnapshotRecord | null): object | null {
  if (snapshot === null) return null
  return {
    id: snapshot.id,
    workflowId: snapshot.definitionId,
    name: snapshot.name,
    description: snapshot.description,
    origin: snapshot.origin,
    path: snapshot.path,
    contentHash: snapshot.contentHash,
    engineVersion: snapshot.engineVersion,
    createdAt: snapshot.createdAt,
  }
}

interface AgentObservability {
  index: number | null
  phaseIndex: number | null
  cached: boolean
  lastTool: string | null
  promptPreview: string | null
  resultPreview: string | null
  worktreeBranch: string | null
  worktreePath: string | null
  transcript: boolean
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function boolean(value: unknown): boolean {
  return value === true
}

function eventData(event: RunEventRecord): Record<string, unknown> | null {
  return object(object(event.payload)?.data)
}

function executionObservability(execution: ExecutionRecord, events: RunEventRecord[]): AgentObservability | null {
  const config = object(execution.effectiveConfig)
  const index = numberOrNull(config?.index)
  const hasTranscript = stringOrNull(config?.transcriptPath) !== null || config?.transcriptSource === 'provider_session'
  const matching = events.filter((event) => {
    if (event.type !== 'workflow.agent') return false
    if (event.executionId === execution.id) return true
    const data = eventData(event)
    const key = stringOrNull(data?.key)
    return key !== null && execution.nodeKey === `workflow:${key}`
  })
  const latest: Record<string, unknown> = {}
  for (const event of matching) {
    const data = eventData(event)
    if (data) Object.assign(latest, data)
  }
  if (matching.length === 0 && index === null && !hasTranscript) return null
  return {
    index: numberOrNull(latest.index) ?? index,
    phaseIndex: numberOrNull(latest.phaseIndex) ?? numberOrNull(config?.phaseIndex),
    cached: boolean(latest.cached),
    lastTool: stringOrNull(latest.lastTool),
    promptPreview: stringOrNull(latest.promptPreview),
    resultPreview: stringOrNull(latest.resultPreview),
    worktreeBranch: stringOrNull(latest.worktreeBranch),
    worktreePath: stringOrNull(latest.worktreePath),
    transcript: hasTranscript,
  }
}

function presentExecution(execution: ExecutionRecord, events: RunEventRecord[]): object {
  return {
    id: execution.id,
    runId: execution.runId,
    nodeKey: execution.nodeKey,
    label: execution.label,
    phase: execution.phase,
    attempt: execution.attempt,
    harness: execution.harness,
    provider: execution.provider,
    model: execution.model,
    transport: object(execution.effectiveConfig)?.transport === 'acp' ? 'acp' : 'native',
    effectiveConfig: execution.effectiveConfig,
    workspaceId: execution.workspaceId,
    input: execution.input,
    output: execution.output,
    status: execution.status,
    usage: executionUsage(execution.usage),
    error: execution.error,
    sessionId: execution.sessionId,
    capabilities: sessionCapabilities(execution.capabilities),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    observability: executionObservability(execution, events),
  }
}

type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

function phaseStatus(executions: ExecutionRecord[], entered: boolean, runStatus: RunRecord['status']): PhaseStatus {
  if (executions.some((execution) => execution.status === 'running' || execution.status === 'queued')) return 'running'
  if (executions.some((execution) => execution.status === 'failed')) return 'failed'
  if (executions.some((execution) => execution.status === 'cancelled')) return 'cancelled'
  if (executions.length > 0 && executions.every((execution) => execution.status === 'skipped')) return 'skipped'
  if (
    executions.length > 0 &&
    executions.every((execution) => execution.status === 'completed' || execution.status === 'skipped')
  )
    return 'completed'
  if (executions.length === 0 && entered && runStatus === 'completed') return 'completed'
  if (!entered && (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled')) return 'skipped'
  return entered ? 'running' : 'pending'
}

function workflowProgress(run: RunRecord, executions: ExecutionRecord[], events: RunEventRecord[]): object {
  const phaseByIndex = new Map<number, { title: string; pending: boolean; entered: boolean }>()
  for (const event of events) {
    if (event.type !== 'workflow.phase') continue
    const data = eventData(event)
    const index = numberOrNull(data?.index)
    const title = stringOrNull(data?.title)
    if (index === null || title === null) continue
    const current = phaseByIndex.get(index)
    const pending = data?.pending === true
    phaseByIndex.set(index, {
      title,
      pending: current?.entered === true ? false : pending,
      entered: current?.entered === true || !pending,
    })
  }
  const byPhase = new Map<number, ExecutionRecord[]>()
  const ungrouped: string[] = []
  for (const execution of executions.filter((entry) => entry.nodeKey !== 'workflow:run')) {
    const obs = executionObservability(execution, events)
    if (obs?.phaseIndex === null || obs?.phaseIndex === undefined) {
      ungrouped.push(execution.id)
      continue
    }
    const group = byPhase.get(obs.phaseIndex) ?? []
    group.push(execution)
    byPhase.set(obs.phaseIndex, group)
    if (!phaseByIndex.has(obs.phaseIndex)) {
      phaseByIndex.set(obs.phaseIndex, {
        title: execution.phase ?? `Phase ${obs.phaseIndex}`,
        pending: false,
        entered: true,
      })
    }
  }
  return {
    phases: [...phaseByIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, phase]) => {
        const grouped = byPhase.get(index) ?? []
        const status = phaseStatus(grouped, phase.entered, run.status)
        return {
          index,
          title: phase.title,
          pending: status === 'pending' && phase.pending && grouped.length === 0,
          status,
          executionIds: grouped
            .sort((left, right) => {
              const leftIndex = executionObservability(left, events)?.index ?? 0
              const rightIndex = executionObservability(right, events)?.index ?? 0
              return leftIndex - rightIndex
            })
            .map((execution) => execution.id),
        }
      }),
    ungroupedExecutionIds: ungrouped,
  }
}

function presentRun(run: RunRecord, snapshot: WorkflowSnapshotRecord | null, harness: string | null): object {
  return {
    id: run.id,
    projectId: run.projectId,
    mode: run.mode,
    input: run.input,
    status: run.status,
    workspacePolicy: run.workspacePolicy,
    workspaceStrategy: run.workspaceStrategy ?? 'isolated_worktree',
    workflowSnapshot: presentSnapshot(snapshot),
    harness,
    environmentId: run.environmentId,
    workspace:
      run.workspaceId === null
        ? null
        : {
            id: run.workspaceId,
            path: run.worktreePath,
            branch: run.branch,
            baseBranch: run.baseBranch,
            baseCommit: run.baseCommit,
            strategy: run.workspaceStrategy ?? 'isolated_worktree',
            state: run.status === 'queued' || run.status === 'provisioning' ? 'provisioning' : 'ready',
          },
    profile: run.profile,
    error: run.error,
    capabilities: {
      cancel: run.status === 'running' || run.status === 'waiting_input',
      resume: run.status === 'interrupted',
    },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    issueRef: run.issueRef,
  }
}

function presentWorkflow(entry: WorkflowCatalogEntry): object | null {
  if (entry.status === 'invalid') return null
  const phases = object(entry.definition.metadata)?.phases
  return {
    id: entry.definition.id,
    name: entry.definition.name,
    description: entry.definition.description,
    origin: entry.definition.origin,
    path: entry.definition.path,
    contentHash: entry.definition.contentHash,
    workspace: object(entry.definition.metadata)?.workspace,
    phases: Array.isArray(phases)
      ? phases.flatMap((phase, index) => {
          const value = object(phase)
          return typeof value?.title === 'string'
            ? [{ key: String(index + 1), label: value.title, detail: stringOrNull(value.detail) }]
            : []
        })
      : [],
    whenToUse: stringOrNull(object(entry.definition.metadata)?.whenToUse),
    defaultProvider: stringOrNull(object(entry.definition.metadata)?.defaultProvider),
    defaultModel: stringOrNull(object(entry.definition.metadata)?.defaultModel),
    defaultSandbox: stringOrNull(object(entry.definition.metadata)?.defaultSandbox),
    availability: entry.status === 'available' ? 'available' : 'unavailable',
    diagnostics:
      entry.status === 'available'
        ? []
        : [entry.status === 'shadowed' ? `Shadowed by ${entry.shadowedBy}` : entry.diagnostic.message],
  }
}

export class RunPresentationService {
  private readonly store: RunStore
  constructor(store: RunStore) {
    this.store = store
  }

  list(projectId: string): ReturnType<typeof RunListResponseSchema.parse> {
    return RunListResponseSchema.parse({
      runs: this.store.listRuns(projectId).map((run) => {
        const rootExecution = this.store.getExecutions(run.id)[0] ?? null
        return presentRun(run, this.store.getWorkflowSnapshot(run.id), rootExecution?.harness ?? null)
      }),
    })
  }

  detail(runId: string): ReturnType<typeof RunDetailResponseSchema.parse> | null {
    const run = this.store.getRun(runId)
    if (run === null) return null
    const executions = this.store.getExecutions(runId)
    const events = this.store.listEvents(runId)
    const publicExecutions = executions.filter((execution) => execution.nodeKey !== 'workflow:run')
    const artifacts = [
      ...(run.result === null
        ? []
        : [{ kind: 'result', label: 'Run result', executionId: null, mimeType: 'application/json', size: null }]),
      ...publicExecutions
        .filter((execution) => executionObservability(execution, events)?.transcript === true)
        .map((execution) => ({
          kind: 'transcript',
          label: `${execution.label} transcript`,
          executionId: execution.id,
          mimeType: 'application/x-ndjson',
          size: null,
        })),
      ...(run.worktreePath === null
        ? []
        : [{ kind: 'workspace', label: run.branch ?? 'Run workspace', executionId: null, mimeType: null, size: null }]),
    ]
    return RunDetailResponseSchema.parse({
      run: {
        ...presentRun(run, this.store.getWorkflowSnapshot(runId), executions[0]?.harness ?? null),
        executions: publicExecutions.map((execution) => presentExecution(execution, events)),
        result: run.result,
        workflowProgress: run.mode === 'workflow' ? workflowProgress(run, executions, events) : null,
        artifacts,
      },
    })
  }

  events(runId: string, after: number | undefined): ReturnType<typeof RunEventsResponseSchema.parse> | null {
    if (this.store.getRun(runId) === null) return null
    const events = this.store.listEvents(runId, after).map((event) => ({
      id: event.id,
      runId: event.runId,
      executionId: event.executionId,
      sessionId: event.sessionId,
      sequence: event.sequence,
      type: event.type,
      timestamp: event.timestamp,
      source: event.source,
      payload: event.payload,
    }))
    return RunEventsResponseSchema.parse({
      events,
      nextCursor: events.at(-1)?.sequence ?? this.store.getEventCursor(runId)?.sequence ?? null,
    })
  }

  async workflows(catalog: WorkflowCatalogService): Promise<ReturnType<typeof WorkflowListResponseSchema.parse>> {
    const entries = await catalog.discover()
    return WorkflowListResponseSchema.parse({
      workflows: entries.entries.map(presentWorkflow).filter((entry): entry is object => entry !== null),
    })
  }
}
