import { describe, expect, it } from 'vitest'
import {
  CreateRunRequestSchema,
  CreateWorktreeRequestSchema,
  ExecutionTranscriptResponseSchema,
  ProjectWorktreeSnapshotSchema,
  RespondRunPermissionRequestSchema,
  RunCapabilitySchema,
  RunDetailResponseSchema,
  RunEventsQuerySchema,
  RunEventsResponseSchema,
  RunStatusSchema,
} from './schemas.ts'

const timestamp = '2026-09-09T12:00:00.000Z'

const runDetail = {
  run: {
    id: 'run_01',
    projectId: 'project_01',
    mode: 'workflow',
    input: { issue: 'TASK-006', labels: ['contract', null] },
    status: 'running',
    workspacePolicy: 'run',
    workspaceStrategy: 'isolated_worktree',
    workflowSnapshot: {
      id: 'snapshot_01',
      workflowId: 'workflow_01',
      name: 'Code review',
      description: 'Review a change',
      origin: 'project',
      path: '/repo/.portta/workflows/review.workflow.js',
      contentHash: 'sha256:abc',
      engineVersion: '1',
      createdAt: timestamp,
    },
    workspace: {
      id: 'workspace_01',
      strategy: 'isolated_worktree',
      path: '/repo-taskflow-run-01',
      branch: 'taskflow/run-01',
      baseBranch: 'main',
      baseCommit: 'abc123',
      state: 'ready',
    },
    profile: 'default',
    error: null,
    capabilities: { cancel: true, resume: false },
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
    executions: [
      {
        id: 'execution_01',
        runId: 'run_01',
        nodeKey: 'review:0',
        label: 'Review',
        phase: 'analysis',
        attempt: 1,
        harness: 'codex',
        provider: 'openai',
        model: 'gpt-5',
        effectiveConfig: { effort: 'high' },
        workspaceId: 'workspace_01',
        input: { issue: 'TASK-006' },
        output: null,
        status: 'running',
        usage: { inputTokens: 123, outputTokens: null, totalTokens: null, costUsd: null },
        error: null,
        sessionId: null,
        capabilities: null,
        startedAt: timestamp,
        completedAt: null,
      },
    ],
    result: null,
    workflowProgress: {
      phases: [{ index: 1, title: 'Review', pending: false, status: 'running', executionIds: ['execution_01'] }],
      ungroupedExecutionIds: [],
    },
    artifacts: [
      {
        kind: 'transcript',
        label: 'Review transcript',
        executionId: 'execution_01',
        mimeType: 'application/x-ndjson',
        size: null,
      },
    ],
  },
}

describe('Run API contracts', () => {
  it('serializes a public Run detail without engine-private identifiers', () => {
    const parsed = RunDetailResponseSchema.parse(runDetail)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(runDetail)
    expect('engineRunId' in parsed.run).toBe(false)
  })

  it('requires the mode-specific creation fields and an idempotency key', () => {
    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'workflow',
        input: { issue: 'TASK-006' },
        idempotencyKey: 'create-01',
      }).success,
    ).toBe(false)

    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'direct',
        harness: 'codex',
        workspace: { strategy: 'current_branch', branch: 'invalid' },
        input: 'Fix it',
        idempotencyKey: 'create-02',
      }).success,
    ).toBe(false)

    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'direct',
        harness: 'codex',
        transport: 'acp',
        permissionMode: 'interactive',
        mcpServers: [{ name: 'everything', command: 'mcp-server-everything', args: [] }],
        workspace: { strategy: 'new_branch', branch: 'fix/task', baseBranch: 'main' },
        input: 'Fix the test',
        idempotencyKey: 'create-02',
      }).success,
    ).toBe(true)

    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'direct',
        harness: 'codex',
        transport: 'automatic',
        input: 'Fix the test',
        idempotencyKey: 'create-invalid-transport',
      }).success,
    ).toBe(false)

    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'workflow',
        workflowId: 'workflow_01',
        transport: 'acp',
        permissionMode: 'interactive',
        input: 'Review it',
        idempotencyKey: 'create-interactive-workflow',
      }).success,
    ).toBe(false)

    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'direct',
        input: 'Fix the test',
        idempotencyKey: 'create-03',
      }).success,
    ).toBe(false)
  })

  it('accepts an optional issueRef on create and on the Run', () => {
    expect(
      CreateRunRequestSchema.safeParse({
        mode: 'direct',
        harness: 'codex',
        transport: 'acp',
        input: 'Resolve github:acme/api#113',
        idempotencyKey: 'create-issue',
        issueRef: 'github:acme/api#113',
        workspace: { strategy: 'isolated_worktree', branch: 'fix/proxy-timeout' },
      }).success,
    ).toBe(true)
    expect(
      RunDetailResponseSchema.parse({
        run: { ...runDetail.run, issueRef: 'github:acme/api#113' },
      }).run.issueRef,
    ).toBe('github:acme/api#113')
    expect(RunDetailResponseSchema.parse(runDetail).run.issueRef).toBeUndefined()

    expect(
      CreateWorktreeRequestSchema.safeParse({
        branch: 'fix/proxy-timeout',
        issueRef: 'github:acme/api#113',
      }).success,
    ).toBe(true)
    expect(ProjectWorktreeSnapshotSchema.partial().parse({ issueRef: 'linear:ENG-42' }).issueRef).toBe('linear:ENG-42')
  })

  it('does not publish unsupported pause or restart actions', () => {
    expect(RunStatusSchema.safeParse('pause_requested').success).toBe(false)
    expect(RunCapabilitySchema.safeParse({ cancel: true, resume: false, pause: false }).success).toBe(false)
  })

  it('validates interactive ACP permission decisions', () => {
    expect(
      RespondRunPermissionRequestSchema.safeParse({
        requestId: '01234567-89ab-4def-8123-456789abcdef',
        optionId: 'allow-once',
      }).success,
    ).toBe(true)
    expect(RespondRunPermissionRequestSchema.safeParse({ requestId: 'not-a-uuid', optionId: null }).success).toBe(false)
  })

  it('accepts an after cursor and rejects unordered event replay', () => {
    expect(RunEventsQuerySchema.parse({ after: '4' })).toEqual({ after: 4 })

    const event = {
      id: 'event_01',
      runId: 'run_01',
      executionId: null,
      sessionId: null,
      type: 'run.started',
      timestamp,
      source: 'run',
      payload: { version: 1, data: { mode: 'workflow' } },
    }

    expect(
      RunEventsResponseSchema.safeParse({
        events: [
          { ...event, sequence: 2 },
          { ...event, id: 'event_02', sequence: 1 },
        ],
        nextCursor: 2,
      }).success,
    ).toBe(false)

    expect(
      RunEventsResponseSchema.safeParse({
        events: [
          { ...event, sequence: 1 },
          { ...event, id: 'event_02', sequence: 2 },
        ],
        nextCursor: 2,
      }).success,
    ).toBe(true)
  })

  it('serializes structured execution transcript chunks', () => {
    const response = ExecutionTranscriptResponseSchema.parse({
      executionId: 'execution_01',
      entries: [
        {
          cursor: 12,
          chunk: {
            t: 1,
            kind: 'meta',
            index: 0,
            label: 'Security',
            provider: 'openai',
            model: 'gpt-5',
            prompt: 'Review auth',
          },
        },
        { cursor: 48, chunk: { t: 2, kind: 'tool', id: 'tool-1', name: 'read', input: { path: 'src/auth.ts' } } },
        { cursor: 92, chunk: { t: 3, kind: 'tool-result', id: 'tool-1', output: 'ok' } },
      ],
      nextCursor: 92,
    })
    expect(response.entries.map((entry) => entry.chunk.kind)).toEqual(['meta', 'tool', 'tool-result'])
  })
})
