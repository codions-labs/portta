import type { ExecutionRecord, RunEventRecord, RunRecord, WorkflowSnapshotRecord } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import type { RunStore } from '../adapters/run-store.ts'
import { RunPresentationService } from '../services/run-presentation-service.ts'

const timestamp = '2026-09-09T12:00:00.000Z'
const run: RunRecord = {
  id: 'run_01',
  projectId: 'project',
  mode: 'workflow',
  input: 'Review',
  status: 'running',
  workspacePolicy: 'run',
  workflowSnapshotId: 'snapshot',
  environmentId: null,
  workspaceId: 'workspace',
  worktreePath: '/work',
  canonicalWorkspacePath: '/work',
  branch: 'review',
  baseBranch: 'main',
  baseCommit: 'abc',
  profile: null,
  engineKind: 'workflow-engine',
  engineRunId: 'engine_01',
  error: null,
  result: null,
  operationId: 'op',
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: timestamp,
  completedAt: null,
  issueRef: null,
}
const snapshot: WorkflowSnapshotRecord = {
  id: 'snapshot',
  runId: run.id,
  definitionId: 'review',
  name: 'Review',
  description: 'Parallel review',
  origin: 'project',
  path: '/repo/review.workflow.js',
  contentHash: 'sha256:abc',
  engineVersion: '1',
  keyVersion: '1',
  source: '',
  metadata: {},
  createdAt: timestamp,
}
function execution(id: string, index: number, status: ExecutionRecord['status']): ExecutionRecord {
  return {
    id,
    runId: run.id,
    nodeKey: `workflow:${index}`,
    label: index === 0 ? 'Security' : 'Performance',
    phase: 'Review',
    attempt: 1,
    harness: 'codex',
    provider: 'openai',
    model: 'gpt-5',
    effectiveConfig: { index, phaseIndex: 1, transcriptPath: `/tmp/runs/engine_01/agents/${index}.jsonl` },
    workspaceId: 'workspace',
    input: 'Review',
    output: null,
    status,
    usage: null,
    error: null,
    sessionId: null,
    capabilities: null,
    checkpoint: null,
    startedAt: timestamp,
    completedAt: status === 'completed' ? timestamp : null,
  }
}

describe('RunPresentationService', () => {
  it('projects parallel executions as siblings in their structured workflow phase', () => {
    const executions = [execution('execution_01', 0, 'completed'), execution('execution_02', 1, 'running')]
    const events: RunEventRecord[] = [
      {
        id: 'event_01',
        runId: run.id,
        executionId: null,
        sessionId: null,
        sequence: 1,
        type: 'workflow.phase',
        timestamp,
        source: 'workflow',
        payload: { version: 1, data: { index: 1, title: 'Review', pending: false } },
      },
      ...executions.map(
        (entry, index): RunEventRecord => ({
          id: `event_0${index + 2}`,
          runId: run.id,
          executionId: entry.id,
          sessionId: null,
          sequence: index + 2,
          type: 'workflow.agent',
          timestamp,
          source: 'workflow',
          payload: { version: 1, data: { index, phaseIndex: 1, key: String(index), lastTool: 'read' } },
        }),
      ),
    ]
    const store = {
      getRun: () => run,
      getWorkflowSnapshot: () => snapshot,
      getExecutions: () => executions,
      listEvents: () => events,
    } as unknown as RunStore
    const detail = new RunPresentationService(store).detail(run.id)

    expect(detail?.run.workflowProgress?.phases).toEqual([
      { index: 1, title: 'Review', pending: false, status: 'running', executionIds: ['execution_01', 'execution_02'] },
    ])
    expect(detail?.run.executions[0]?.observability?.lastTool).toBe('read')
    expect(detail?.run.artifacts.filter((artifact) => artifact.kind === 'transcript')).toHaveLength(2)
  })

  it('marks an entered phase without agent executions completed when the workflow completes', () => {
    const completedRun: RunRecord = {
      ...run,
      status: 'completed',
      completedAt: timestamp,
      result: { marker: 'done' },
    }
    const events: RunEventRecord[] = [
      {
        id: 'event_empty_phase',
        runId: run.id,
        executionId: null,
        sessionId: null,
        sequence: 1,
        type: 'workflow.phase',
        timestamp,
        source: 'workflow',
        payload: { version: 1, data: { index: 1, title: 'Smoke', pending: false } },
      },
    ]
    const store = {
      getRun: () => completedRun,
      getWorkflowSnapshot: () => snapshot,
      getExecutions: () => [],
      listEvents: () => events,
    } as unknown as RunStore

    expect(new RunPresentationService(store).detail(run.id)?.run.workflowProgress?.phases).toEqual([
      { index: 1, title: 'Smoke', pending: false, status: 'completed', executionIds: [] },
    ])
  })

  it('marks unentered phases skipped when a branching workflow completes early', () => {
    const completedRun: RunRecord = {
      ...run,
      status: 'completed',
      completedAt: timestamp,
      result: { marker: 'early-return' },
    }
    const events: RunEventRecord[] = [
      {
        id: 'event_pending_phase',
        runId: run.id,
        executionId: null,
        sessionId: null,
        sequence: 1,
        type: 'workflow.phase',
        timestamp,
        source: 'workflow',
        payload: { version: 1, data: { index: 2, title: 'Escalate', pending: true } },
      },
    ]
    const store = {
      getRun: () => completedRun,
      getWorkflowSnapshot: () => snapshot,
      getExecutions: () => [],
      listEvents: () => events,
    } as unknown as RunStore

    expect(new RunPresentationService(store).detail(run.id)?.run.workflowProgress?.phases).toEqual([
      { index: 2, title: 'Escalate', pending: false, status: 'skipped', executionIds: [] },
    ])
  })

  it('exposes provider transcripts for Direct Run executions', () => {
    const directRun: RunRecord = {
      ...run,
      mode: 'direct',
      workflowSnapshotId: null,
      engineKind: null,
      engineRunId: null,
    }
    const directExecution: ExecutionRecord = {
      ...execution('execution_direct', 0, 'running'),
      nodeKey: 'direct:root',
      label: 'Direct session',
      effectiveConfig: { profile: 'default', transcriptSource: 'provider_session' },
      sessionId: 'provider-session',
    }
    const store = {
      getRun: () => directRun,
      getWorkflowSnapshot: () => null,
      getExecutions: () => [directExecution],
      listEvents: () => [],
    } as unknown as RunStore

    const detail = new RunPresentationService(store).detail(run.id)
    expect(detail?.run.executions[0]?.observability?.transcript).toBe(true)
    expect(detail?.run.artifacts).toContainEqual({
      kind: 'transcript',
      label: 'Direct session transcript',
      executionId: 'execution_direct',
      mimeType: 'application/x-ndjson',
      size: null,
    })
  })
})
