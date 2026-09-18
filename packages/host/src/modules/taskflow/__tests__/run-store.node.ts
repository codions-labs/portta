import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { CreateRunRecord, ExecutionRecord, RunEventRecord, WorkflowSnapshotRecord } from 'portta-core/taskflow'
import type {
  GitGateway,
  GitWorktreeEntry,
  GitWorktreeStatus,
  TryGitCommandResult,
  UnpushedCommit,
} from '../adapters/git.ts'
import { createRunStore, type RunStore } from '../adapters/run-store.ts'
import { TaskflowExecutionPort } from '../adapters/taskflow-execution-port.ts'
import { RunPresentationService } from '../services/run-presentation-service.ts'
import { type CreateDirectRunInput, type CreateWorkflowRunInput, RunService } from '../services/run-service.ts'
import { WorkflowEventBridge } from '../services/workflow-event-bridge.ts'
import type {
  WorkflowRunControl,
  WorkflowRunHandle,
  WorkflowRunInspection,
  WorkflowRunner,
  WorkflowRunSpec,
  WorkflowWorkerTerminal,
} from '../services/workflow-runner.ts'
import { type ProvisionWorkspaceInput, WorkspaceFacade } from '../services/workspace-facade.ts'

const timestamp = '2026-09-09T12:00:00.000Z'
const stores: RunStore[] = []
const tempDirs: string[] = []

afterEach(async () => {
  stores.splice(0).forEach((store) => {
    store.close()
  })
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function freshStore(): Promise<RunStore> {
  const directory = await mkdtemp(join(tmpdir(), 'taskflow-run-store-'))
  tempDirs.push(directory)
  const store = createRunStore(join(directory, 'taskflow.db'))
  stores.push(store)
  return store
}

function createRun(overrides: Partial<CreateRunRecord> = {}): CreateRunRecord {
  return {
    id: 'run_01',
    projectId: 'project_01',
    mode: 'workflow',
    input: { issue: 'TASK-007' },
    status: 'provisioning',
    workspacePolicy: 'run',
    workflowSnapshotId: 'snapshot_01',
    environmentId: null,
    workspaceId: 'workspace_01',
    worktreePath: '/worktrees/run-01',
    canonicalWorkspacePath: '/private/worktrees/run-01',
    branch: 'taskflow/run-01',
    baseBranch: 'main',
    baseCommit: 'abc123',
    profile: 'default',
    engineKind: 'workflow-engine',
    engineRunId: null,
    operationId: 'operation_01',
    createdAt: timestamp,
    issueRef: null,
    ...overrides,
  }
}

function createSnapshot(runId: string = 'run_01'): WorkflowSnapshotRecord {
  return {
    id: 'snapshot_01',
    runId,
    definitionId: 'workflow_01',
    name: 'Review',
    description: 'Review the change',
    origin: 'project',
    path: '/repo/.portta/workflows/review.workflow.js',
    contentHash: 'sha256:abc',
    engineVersion: '1',
    keyVersion: 'v3',
    source: 'export const meta = {}',
    metadata: { name: 'Review' },
    createdAt: timestamp,
  }
}

function createExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
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
    input: { issue: 'TASK-007' },
    output: null,
    status: 'running',
    usage: null,
    error: null,
    sessionId: null,
    capabilities: null,
    checkpoint: null,
    startedAt: timestamp,
    completedAt: null,
    ...overrides,
  }
}

function fakeGit(
  worktrees: GitWorktreeEntry[] = [],
): GitGateway & { removed: string[]; deleted: string[]; status: GitWorktreeStatus } {
  const removed: string[] = []
  const deleted: string[] = []
  const status: GitWorktreeStatus = { dirty: false, aheadCount: 0, currentCommit: 'abc123' }
  const command: TryGitCommandResult = { ok: true, stdout: '' }
  const commits: UnpushedCommit[] = []
  return {
    removed,
    deleted,
    status,
    resolveRepoRoot: (path): string | null => path,
    resolveWorktreeRoot: (path): string => path,
    resolveWorktreeGitDir: (path): string => path,
    listWorktrees: (): GitWorktreeEntry[] => worktrees,
    listLiveWorktrees: (): GitWorktreeEntry[] => worktrees,
    listLocalBranches: (): string[] => [],
    listRemoteBranches: (): string[] => [],
    readWorktreeStatus: (): GitWorktreeStatus => status,
    readStatus: (): string => '',
    createWorktree: (): void => {},
    removeWorktree: ({ worktreePath }): void => {
      removed.push(worktreePath)
    },
    deleteBranch: (_root, branch): void => {
      deleted.push(branch)
    },
    mergeBranch: (): void => {},
    currentBranch: (): string => 'main',
    resolveCommit: (): string => 'abc123',
    createAndSwitchBranch: (): void => {},
    readDiff: (): string => '',
    listUnpushedCommits: (): UnpushedCommit[] => commits,
    countUnsavedCommits: (): number => 0,
    fetchBranch: (): TryGitCommandResult => command,
    fastForwardMerge: (): TryGitCommandResult => command,
    hardReset: (): TryGitCommandResult => command,
  }
}

class FakeWorkflowRunner implements WorkflowRunner {
  private control: WorkflowRunControl | undefined
  private resolve: ((terminal: WorkflowWorkerTerminal) => void) | undefined
  private active = false
  private cursor = 0
  specs: WorkflowRunSpec[] = []

  run(spec: WorkflowRunSpec, control: WorkflowRunControl = {}): WorkflowRunHandle {
    this.specs.push(spec)
    this.control = control
    this.active = true
    this.cursor = spec.cursor ?? 0
    const done = new Promise<WorkflowWorkerTerminal>((resolve): void => {
      this.resolve = resolve
    })
    const runner = this
    return {
      pid: 321,
      get cursor(): number {
        return runner.cursor
      },
      get cancelAcknowledged(): boolean {
        return false
      },
      done,
      cancel: async (): Promise<void> => {
        runner.finish({ type: 'failed', cursor: runner.cursor, error: 'cancelled' })
      },
    }
  }

  inspect(engineRunId: string): WorkflowRunInspection | null {
    return this.active ? { engineRunId, pid: 321, cursor: this.cursor, active: true } : null
  }

  emit(sequence: number, event: unknown): void {
    this.cursor = sequence
    this.control?.onMessage?.({
      type: 'event',
      version: 1,
      runId: 'run_workflow_01',
      engineRunId: 'engine_run_workflow_01',
      cursor: sequence,
      event,
    })
  }

  heartbeat(sequence: number): void {
    this.cursor = sequence
    this.control?.onMessage?.({
      type: 'heartbeat',
      version: 1,
      runId: 'run_workflow_01',
      engineRunId: 'engine_run_workflow_01',
      cursor: sequence,
    })
  }

  finish(terminal: WorkflowWorkerTerminal): void {
    this.active = false
    this.cursor = terminal.cursor
    this.resolve?.(terminal)
  }
}

describe('RunStore', () => {
  it('allows concurrent readers but blocks incompatible checkout writers', async () => {
    const store = await freshStore()
    for (const [id, operationId] of [
      ['run_reader_1', 'op_reader_1'],
      ['run_reader_2', 'op_reader_2'],
      ['run_writer', 'op_writer'],
    ] as const) {
      store.createRun(
        createRun({
          id,
          operationId,
          mode: 'direct',
          workflowSnapshotId: null,
          workspaceId: null,
          worktreePath: null,
          canonicalWorkspacePath: null,
          branch: null,
        }),
      )
    }
    assert.deepEqual(
      store.acquireCheckoutClaim({
        runId: 'run_reader_1',
        projectId: 'project_01',
        canonicalPath: '/repo',
        access: 'shared_read',
        createdAt: timestamp,
      }),
      { ok: true },
    )
    assert.deepEqual(
      store.acquireCheckoutClaim({
        runId: 'run_reader_2',
        projectId: 'project_01',
        canonicalPath: '/repo',
        access: 'shared_read',
        createdAt: timestamp,
      }),
      { ok: true },
    )
    assert.deepEqual(
      store.acquireCheckoutClaim({
        runId: 'run_writer',
        projectId: 'project_01',
        canonicalPath: '/repo',
        access: 'exclusive_write',
        createdAt: timestamp,
      }),
      {
        ok: false,
        reason: 'checkout_busy',
        conflictingRunIds: ['run_reader_1', 'run_reader_2'],
      },
    )
    store.releaseCheckoutClaim('run_reader_1')
    store.releaseCheckoutClaim('run_reader_2')
    assert.deepEqual(
      store.acquireCheckoutClaim({
        runId: 'run_writer',
        projectId: 'project_01',
        canonicalPath: '/repo',
        access: 'exclusive_write',
        createdAt: timestamp,
      }),
      { ok: true },
    )
  })

  it('migrates and persists a Run with its immutable workflow snapshot', async () => {
    const store = await freshStore()
    const created = store.createRun(createRun(), createSnapshot())

    assert.equal(created.ok, true)
    assert.equal(created.ok && created.replayed, false)
    assert.deepEqual(store.getRun('run_01')?.status, 'provisioning')
    assert.deepEqual(store.getRun('run_01')?.branch, 'taskflow/run-01')
    assert.equal(store.listRuns('project_01').length, 1)
    assert.equal(store.getWorkflowSnapshot('run_01')?.id, 'snapshot_01')
    assert.equal(store.getWorkflowSnapshot('run_01')?.contentHash, 'sha256:abc')
    assert.equal(store.getWorkflowSnapshot('run_01')?.keyVersion, 'v3')
  })

  it('persists an issueRef on the Run and leaves it absent when none was given', async () => {
    const store = await freshStore()
    store.createRun(createRun({ issueRef: 'github:acme/api#113' }), createSnapshot())
    assert.equal(store.getRun('run_01')?.issueRef, 'github:acme/api#113')

    store.createRun(
      createRun({
        id: 'run_02',
        operationId: 'operation_02',
        mode: 'direct',
        workflowSnapshotId: null,
        workspaceId: null,
        worktreePath: null,
        canonicalWorkspacePath: null,
        branch: null,
      }),
    )
    assert.equal(store.getRun('run_02')?.issueRef ?? null, null)
  })

  it('replays an idempotent create without adding a second Run', async () => {
    const store = await freshStore()
    store.createRun(createRun(), createSnapshot())

    const replay = store.createRun(createRun({ id: 'run_other' }))

    assert.equal(replay.ok, true)
    assert.equal(replay.ok && replay.replayed, true)
    assert.equal(replay.ok && replay.run.id, 'run_01')
    assert.equal(store.listRuns('project_01').length, 1)
  })

  it('prevents duplicate project branches and canonical workspace paths', async () => {
    const store = await freshStore()
    store.createRun(createRun(), createSnapshot())

    assert.deepEqual(
      store.createRun(
        createRun({
          id: 'run_02',
          operationId: 'operation_02',
          workflowSnapshotId: null,
          canonicalWorkspacePath: '/private/worktrees/run-02',
        }),
      ),
      {
        ok: false,
        reason: 'branch_conflict',
      },
    )
    assert.deepEqual(
      store.createRun(
        createRun({
          id: 'run_03',
          operationId: 'operation_03',
          workflowSnapshotId: null,
          branch: 'taskflow/run-03',
        }),
      ),
      { ok: false, reason: 'workspace_path_conflict' },
    )
  })

  it('reserves a workspace once and keeps the same reservation on retry', async () => {
    const store = await freshStore()
    store.createRun(
      createRun({
        workspaceId: null,
        worktreePath: null,
        canonicalWorkspacePath: null,
        branch: null,
        baseBranch: null,
        baseCommit: null,
      }),
      createSnapshot(),
    )
    const reservation = {
      runId: 'run_01',
      workspaceId: 'workspace_01',
      worktreePath: '/worktrees/run-01',
      canonicalWorkspacePath: '/private/worktrees/run-01',
      branch: 'taskflow/run-01',
      baseBranch: 'main',
      baseCommit: 'abc123',
      strategy: 'isolated_worktree' as const,
      access: 'exclusive_write' as const,
      updatedAt: timestamp,
    }

    assert.deepEqual(store.reserveWorkspace(reservation), {
      ok: true,
      replayed: false,
      run: {
        ...createRun({
          workspaceId: 'workspace_01',
          worktreePath: '/worktrees/run-01',
          canonicalWorkspacePath: '/private/worktrees/run-01',
          branch: 'taskflow/run-01',
          baseBranch: 'main',
          baseCommit: 'abc123',
          workspaceStrategy: 'isolated_worktree',
          workspaceAccess: 'exclusive_write',
        }),
        workflowSnapshotId: 'snapshot_01',
        error: null,
        result: null,
        updatedAt: timestamp,
        startedAt: null,
        completedAt: null,
      },
    })
    assert.equal(store.reserveWorkspace(reservation).ok, true)
    assert.equal(store.getRun('run_01')?.status, 'provisioning')
    assert.equal(store.setEnvironment('run_01', 'env_01', timestamp)?.environmentId, 'env_01')
    assert.equal(store.getRun('run_01')?.environmentId, 'env_01')
  })

  it('rejects invalid Run transitions without changing the persisted Run', async () => {
    const store = await freshStore()
    store.createRun(createRun(), createSnapshot())

    assert.deepEqual(store.transitionRun('run_01', 'completed', timestamp), {
      ok: false,
      reason: 'invalid_transition',
    })
    assert.equal(store.getRun('run_01')?.status, 'provisioning')
    const transitioned = store.transitionRun('run_01', 'running', timestamp)
    assert.equal(transitioned.ok, true)
    assert.equal(transitioned.ok && transitioned.run.status, 'running')
  })

  it('rolls back the execution projection when its event cursor regresses', async () => {
    const store = await freshStore()
    store.createRun(createRun(), createSnapshot())
    assert.deepEqual(
      store.applyExecutionProjection({
        execution: createExecution(),
        cursor: { runId: 'run_01', sequence: 2, source: 'workflow', updatedAt: timestamp },
      }),
      { ok: true },
    )

    assert.deepEqual(
      store.applyExecutionProjection({
        execution: createExecution({ status: 'completed', completedAt: timestamp }),
        cursor: { runId: 'run_01', sequence: 1, source: 'workflow', updatedAt: timestamp },
      }),
      { ok: false, reason: 'cursor_regression' },
    )
    assert.equal(store.getExecutions('run_01')[0]?.status, 'running')
    assert.equal(store.getEventCursor('run_01')?.sequence, 2)
  })

  it('persists each workflow event once with its projection and cursor', async () => {
    const store = await freshStore()
    store.createRun(createRun(), createSnapshot())
    const event: RunEventRecord = {
      id: 'event_01',
      runId: 'run_01',
      executionId: 'execution_01',
      sessionId: null,
      sequence: 1,
      type: 'workflow.agent',
      timestamp,
      source: 'workflow',
      payload: { version: 1, data: { state: 'running' } },
    }

    assert.deepEqual(
      store.appendEvent({
        event,
        execution: createExecution(),
        cursor: { runId: 'run_01', sequence: 1, source: 'workflow', updatedAt: timestamp },
      }),
      { ok: true, replayed: false },
    )
    assert.deepEqual(
      store.appendEvent({
        event,
        execution: createExecution({ status: 'completed', completedAt: timestamp }),
        cursor: { runId: 'run_01', sequence: 1, source: 'workflow', updatedAt: timestamp },
      }),
      { ok: true, replayed: true },
    )
    assert.deepEqual(store.listEvents('run_01'), [event])
    assert.equal(store.getExecutions('run_01')[0]?.status, 'running')
    assert.equal(store.getEventCursor('run_01')?.sequence, 1)
  })

  it('presents durable Runs and ordered event replay through the public contract', async () => {
    const store = await freshStore()
    store.createRun(createRun(), createSnapshot())
    store.appendEvent({
      event: {
        id: 'event_01',
        runId: 'run_01',
        executionId: null,
        sessionId: null,
        sequence: 1,
        type: 'workflow.log',
        timestamp,
        source: 'workflow',
        payload: { version: 1, data: { message: 'started' } },
      },
      cursor: { runId: 'run_01', sequence: 1, source: 'workflow', updatedAt: timestamp },
    })
    const presentation = new RunPresentationService(store)

    assert.equal(presentation.list('project_01').runs[0]?.id, 'run_01')
    assert.equal(presentation.detail('run_01')?.run.workflowSnapshot?.workflowId, 'workflow_01')
    assert.deepEqual(
      presentation.events('run_01', 0)?.events.map((event) => event.sequence),
      [1],
    )
  })

  it('provisions only its reserved workspace and requires explicit discard', async () => {
    const store = await freshStore()
    store.createRun(
      createRun({
        workspaceId: null,
        worktreePath: null,
        canonicalWorkspacePath: null,
        branch: null,
        baseBranch: null,
        baseCommit: null,
      }),
      createSnapshot(),
    )
    const entries: GitWorktreeEntry[] = []
    const git = fakeGit(entries)
    const created: string[] = []
    const createdRunIds: Array<string | undefined> = []
    const facade = new WorkspaceFacade({
      store,
      git,
      createManagedWorktree: async (options): Promise<void> => {
        created.push(options.worktreePath)
        createdRunIds.push(options.runId)
      },
      now: (): Date => new Date(timestamp),
    })
    const input: ProvisionWorkspaceInput = {
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      baseBranch: 'main',
      baseCommit: 'abc123',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
    }

    const provisioned = await facade.provision(input)
    assert.equal(provisioned.ok, true)
    assert.deepEqual(created, ['/repo/__worktrees/taskflow-run-run-01'])
    assert.deepEqual(createdRunIds, ['run_01'])
    assert.deepEqual(await facade.remove('run_01', '/repo', false), { ok: false, reason: 'confirmation_required' })
    entries.push({
      path: '/repo/__worktrees/taskflow-run-run-01',
      branch: 'taskflow/run-run-01',
      head: 'abc123',
      detached: false,
      bare: false,
    })
    assert.equal(facade.reconcile('run_01', '/repo'), 'attached')
    const removed = await facade.remove('run_01', '/repo', true)
    assert.equal(removed.ok, true)
    assert.deepEqual(git.removed, ['/repo/__worktrees/taskflow-run-run-01'])
    assert.deepEqual(git.deleted, ['taskflow/run-run-01'])
  })

  it('binds current-branch Runs to the checkout without creating a worktree', async () => {
    const store = await freshStore()
    store.createRun(
      createRun({
        mode: 'direct',
        workflowSnapshotId: null,
        workspaceId: null,
        worktreePath: null,
        canonicalWorkspacePath: null,
        branch: null,
        baseBranch: null,
        baseCommit: null,
      }),
    )
    let created = false
    const facade = new WorkspaceFacade({
      store,
      git: fakeGit(),
      createManagedWorktree: async (): Promise<void> => {
        created = true
      },
      now: (): Date => new Date(timestamp),
    })
    const provisioned = await facade.provision({
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      baseBranch: 'main',
      baseCommit: 'abc123',
      profile: 'default',
      agent: 'codex',
      runtime: 'host',
      workspace: { strategy: 'current_branch' },
      access: 'exclusive_write',
    })
    assert.equal(provisioned.ok, true)
    assert.equal(created, false)
    assert.equal(provisioned.ok && provisioned.workspace?.path, '/repo')
    assert.equal(provisioned.ok && provisioned.workspace?.branch, 'main')
    assert.equal(store.getRun('run_01')?.workspaceStrategy, 'current_branch')
    assert.equal(facade.reconcile('run_01', '/repo'), 'attached')
  })

  it('orchestrates durable Direct Runs and never restarts a lost session automatically', async () => {
    const store = await freshStore()
    const entries: GitWorktreeEntry[] = []
    const git = fakeGit(entries)
    const facade = new WorkspaceFacade({
      store,
      git,
      createManagedWorktree: async (options): Promise<void> => {
        entries.push({
          path: options.worktreePath,
          branch: options.branch,
          head: 'abc123',
          detached: false,
          bare: false,
        })
      },
      now: (): Date => new Date(timestamp),
    })
    let starts = 0
    let resumes = 0
    let resumedSessionId = null
    let sessionActive = true
    let sessionActivity: 'running' | 'waiting_input' = 'running'
    const publishedEvents: RunEventRecord[] = []
    const service = new RunService({
      store,
      workspaces: facade,
      directSessions: {
        start: async () => {
          starts += 1
          return {
            sessionId: 'session_01',
            checkpoint: { thread: 'provider-private' },
            capabilities: { terminal: true, interactiveInput: true, interrupt: false, resume: true },
            active: true,
            activity: 'running',
          }
        },
        cancel: async (): Promise<void> => {},
        resume: async (input) => {
          resumes += 1
          resumedSessionId = input.sessionId
          return {
            sessionId: 'session_01',
            checkpoint: { thread: 'provider-private' },
            capabilities: { terminal: true, interactiveInput: true, interrupt: false, resume: true },
            active: true,
            activity: 'running',
          }
        },
        inspect: async () => ({
          sessionId: 'session_01',
          checkpoint: { thread: 'provider-private' },
          capabilities: { terminal: true, interactiveInput: true, interrupt: false, resume: true },
          active: sessionActive,
          activity: sessionActivity,
        }),
      },
      eventPublisher: { publish: (event) => publishedEvents.push(event) },
      now: (): Date => new Date(timestamp),
    })
    const input: CreateDirectRunInput = {
      id: 'run_direct_01',
      projectId: 'project_01',
      input: 'Fix the tests',
      operationId: 'direct-operation-01',
      harness: 'codex',
      provider: 'openai',
      model: 'gpt-5',
      profile: 'default',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      baseBranch: 'main',
      baseCommit: 'abc123',
      agent: 'codex',
      runtime: 'host',
    }

    const created = await service.createDirect(input)
    assert.equal(created.ok, true)
    assert.equal(created.ok && created.run.status, 'running')
    assert.equal(starts, 1)
    assert.deepEqual(store.getExecutions('run_direct_01')[0]?.checkpoint, { thread: 'provider-private' })
    assert.deepEqual(await service.createDirect(input), {
      ok: true,
      run: store.getRun('run_direct_01'),
      replayed: true,
    })
    assert.equal(starts, 1)
    assert.deepEqual(await service.cancel('run_direct_01'), { ok: false, reason: 'capability_unavailable' })
    sessionActivity = 'waiting_input'
    const reconciled = await service.reconcileProject('project_01', '/repo')
    assert.equal(reconciled[0]?.status, 'waiting_input')
    assert.deepEqual(
      publishedEvents.map((event) => event.type),
      ['direct.status'],
    )
    assert.deepEqual(store.listEvents('run_direct_01')[0]?.payload, {
      version: 1,
      data: { status: 'waiting_input' },
    })
    sessionActivity = 'running'
    assert.equal((await service.reconcileProject('project_01', '/repo'))[0]?.status, 'running')
    sessionActive = false
    const interrupted = await service.reconcileProject('project_01', '/repo')
    assert.equal(interrupted[0]?.status, 'interrupted')
    assert.equal(store.getExecutions('run_direct_01')[0]?.status, 'failed')
    assert.equal(starts, 1)
    const resumed = await service.resume('run_direct_01')
    assert.equal(resumed.ok, true)
    assert.equal(resumed.ok && resumed.run.status, 'running')
    assert.equal(resumes, 1)
    assert.equal(resumedSessionId, 'session_01')
  })

  it('projects workflow events once, interrupts on cancel, and resumes from the frozen snapshot', async () => {
    const store = await freshStore()
    const entries: GitWorktreeEntry[] = []
    const git = fakeGit(entries)
    const facade = new WorkspaceFacade({
      store,
      git,
      createManagedWorktree: async (options): Promise<void> => {
        entries.push({
          path: options.worktreePath,
          branch: options.branch,
          head: 'abc123',
          detached: false,
          bare: false,
        })
      },
      now: (): Date => new Date(timestamp),
    })
    const runner = new FakeWorkflowRunner()
    const published: RunEventRecord[] = []
    const service = new RunService({
      store,
      workspaces: facade,
      directSessions: {
        start: async () => ({
          sessionId: 'unused',
          checkpoint: null,
          capabilities: { terminal: false, interactiveInput: false, interrupt: false, resume: false },
          active: false,
          activity: 'running',
        }),
        cancel: async (): Promise<void> => {},
        resume: async () => ({
          sessionId: 'unused',
          checkpoint: null,
          capabilities: { terminal: false, interactiveInput: false, interrupt: false, resume: false },
          active: false,
          activity: 'running',
        }),
        inspect: async () => null,
      },
      workflowRunner: runner,
      workflowEvents: new WorkflowEventBridge({
        store,
        publisher: {
          publish: (event): void => {
            published.push(event)
          },
        },
        now: (): Date => new Date(timestamp),
      }),
      now: (): Date => new Date(timestamp),
    })
    const input: CreateWorkflowRunInput = {
      id: 'run_workflow_01',
      projectId: 'project_01',
      input: { issue: 'TASK-013' },
      operationId: 'workflow-operation-01',
      snapshot: createSnapshot('run_workflow_01'),
      dataRoot: '/taskflow-data',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      baseBranch: 'main',
      baseCommit: 'abc123',
      profile: 'default',
      agent: 'codex',
      runtime: 'host',
      fake: true,
    }

    const created = await service.createWorkflow(input)
    assert.equal(created.ok, true)
    assert.equal(created.ok && created.run.engineRunId, 'engine_run_workflow_01')
    runner.heartbeat(0)
    assert.deepEqual(
      store.getExecutions('run_workflow_01').find((execution) => execution.nodeKey === 'workflow:run')?.checkpoint,
      {
        engineRunId: 'engine_run_workflow_01',
        pid: 321,
        cursor: 0,
        lastHeartbeatAt: timestamp,
      },
    )
    runner.emit(1, {
      t: 1_725_969_600_000,
      type: 'agent',
      key: 'review-key',
      index: 1,
      label: 'Review',
      provider: 'openai',
      state: 'running',
    })
    runner.emit(1, {
      t: 1_725_969_600_000,
      type: 'agent',
      key: 'review-key',
      index: 1,
      label: 'Review',
      provider: 'openai',
      state: 'running',
    })
    assert.equal(store.listEvents('run_workflow_01').length, 1)
    assert.equal(published.length, 1)
    assert.equal(
      store.getExecutions('run_workflow_01').filter((execution) => execution.nodeKey === 'workflow:review-key').length,
      1,
    )

    await service.shutdownProject('project_01', '/repo')
    assert.deepEqual(
      store.getExecutions('run_workflow_01').find((execution) => execution.nodeKey === 'workflow:run')?.checkpoint,
      {
        engineRunId: 'engine_run_workflow_01',
        pid: 321,
        cursor: 1,
      },
    )
    await new Promise<void>((resolve): void => {
      setImmediate(resolve)
    })
    assert.equal(store.getRun('run_workflow_01')?.status, 'interrupted')

    const resumed = await service.resumeWorkflow('run_workflow_01')
    assert.equal(resumed.ok, true)
    assert.equal(runner.specs.length, 2)
    assert.equal(runner.specs[1]?.spec.resume, true)
    assert.equal(runner.specs[1]?.spec.source, input.snapshot.source)
    runner.emit(2, {
      t: 1_725_969_600_000,
      type: 'agent',
      key: 'review-key',
      index: 1,
      label: 'Review',
      provider: 'openai',
      state: 'done',
      cached: true,
    })
    runner.finish({ type: 'completed', cursor: 2, result: { approved: true } })
    await new Promise<void>((resolve): void => {
      setImmediate(resolve)
    })
    assert.deepEqual(store.getRun('run_workflow_01')?.result, { approved: true })
    assert.equal(
      store.getExecutions('run_workflow_01').find((execution) => execution.nodeKey === 'workflow:review-key')?.status,
      'completed',
    )
    assert.deepEqual(
      store.getExecutions('run_workflow_01').find((execution) => execution.nodeKey === 'workflow:review-key')
        ?.effectiveConfig,
      {
        key: 'review-key',
        index: 1,
        phaseIndex: null,
        transcriptPath: '/taskflow-data/runs/engine_run_workflow_01/agents/1.jsonl',
      },
    )
    assert.deepEqual(
      store.getExecutions('run_workflow_01').find((execution) => execution.nodeKey === 'workflow:run')?.output,
      {
        resultPath: '/taskflow-data/runs/engine_run_workflow_01/result.json',
      },
    )
  })

  it('acquires exclusive child leases from the parent base commit and rolls back a failed fork', async () => {
    const store = await freshStore()
    store.createRun(
      createRun({
        workspaceId: null,
        worktreePath: null,
        canonicalWorkspacePath: null,
        branch: null,
        baseBranch: null,
        baseCommit: null,
      }),
      createSnapshot(),
    )
    const entries: GitWorktreeEntry[] = []
    const git = fakeGit(entries)
    const created: string[] = []
    const facade = new WorkspaceFacade({
      store,
      git,
      createManagedWorktree: async (options): Promise<void> => {
        if (options.worktreePath.includes('broken')) throw new Error('git failed')
        created.push(`${options.worktreePath}@${options.baseBranch}`)
        entries.push({
          path: options.worktreePath,
          branch: options.branch,
          head: options.baseBranch ?? 'abc123',
          detached: false,
          bare: false,
        })
      },
      now: (): Date => new Date(timestamp),
    })
    const parentInput: ProvisionWorkspaceInput = {
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      baseBranch: 'main',
      baseCommit: 'abc123',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
    }
    assert.equal((await facade.provision(parentInput)).ok, true)

    const first = await facade.acquireFork({
      leaseId: 'lease_a',
      runId: 'run_01',
      executionId: 'execution_a',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      slug: 'alpha',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
    })
    const second = await facade.acquireFork({
      leaseId: 'lease_b',
      runId: 'run_01',
      executionId: 'execution_b',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      slug: 'beta',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
    })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(first.ok && first.lease?.baseCommit, 'abc123')
    assert.equal(second.ok && second.lease?.baseCommit, 'abc123')
    assert.notEqual(first.ok && first.workspace?.path, second.ok && second.workspace?.path)
    assert.notEqual(first.ok && first.workspace?.branch, second.ok && second.workspace?.branch)
    assert.deepEqual(created, [
      '/repo/__worktrees/taskflow-run-run-01@main',
      '/repo/__worktrees/taskflow-run-run-01-fork-alpha@abc123',
      '/repo/__worktrees/taskflow-run-run-01-fork-beta@abc123',
    ])
    const replayed = await facade.acquireFork({
      leaseId: 'lease_a',
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      slug: 'alpha',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
    })
    assert.equal(replayed.ok, true)
    assert.equal(replayed.ok && replayed.replayed, true)
    assert.equal(replayed.ok && replayed.lease?.id, 'lease_a')
    assert.equal(facade.reconcileLease('lease_a', '/repo'), 'attached')
    assert.deepEqual(facade.summarizeLease('lease_a', '/repo'), {
      leaseId: 'lease_a',
      branch: 'taskflow/run-run-01-fork-alpha',
      baseCommit: 'abc123',
      head: 'abc123',
      dirty: false,
      aheadCount: 0,
    })

    const failed = await facade.acquireFork({
      leaseId: 'lease_broken',
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      slug: 'broken',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
    })
    assert.deepEqual(failed, { ok: false, reason: 'workspace_path_conflict' })
    assert.equal(store.getLease('lease_broken'), null)
    assert.equal(store.listLeases('run_01').length, 2)

    git.status.dirty = true
    const preserved = await facade.releaseFork('lease_a', '/repo', false)
    assert.equal(preserved.ok, true)
    assert.equal(preserved.ok && preserved.lease?.status, 'preserved')
    assert.equal(git.removed.length, 0)
    const discarded = await facade.releaseFork('lease_a', '/repo', true)
    assert.equal(discarded.ok, true)
    assert.equal(discarded.ok && discarded.lease?.status, 'released')
    assert.ok(git.removed.includes('/repo/__worktrees/taskflow-run-run-01-fork-alpha'))
    const releasedAgain = await facade.releaseFork('lease_a', '/repo', true)
    assert.equal(releasedAgain.ok && releasedAgain.replayed, true)
    assert.equal(releasedAgain.ok && releasedAgain.lease?.status, 'released')

    const beta = entries.find((entry) => entry.branch?.endsWith('fork-beta'))
    if (beta) beta.branch = 'foreign'
    assert.equal(facade.reconcileLease('lease_b', '/repo'), 'foreign')
  })

  it('injects an ExecutionPort that acquires and releases fork leases without sharing cwd', async () => {
    const store = await freshStore()
    store.createRun(
      createRun({
        workspaceId: null,
        worktreePath: null,
        canonicalWorkspacePath: null,
        branch: null,
        baseBranch: null,
        baseCommit: null,
      }),
      createSnapshot(),
    )
    const entries: GitWorktreeEntry[] = []
    const git = fakeGit(entries)
    const facade = new WorkspaceFacade({
      store,
      git,
      createManagedWorktree: async (options): Promise<void> => {
        entries.push({
          path: options.worktreePath,
          branch: options.branch,
          head: 'abc123',
          detached: false,
          bare: false,
        })
      },
      now: (): Date => new Date(timestamp),
    })
    assert.equal(
      (
        await facade.provision({
          runId: 'run_01',
          projectRoot: '/repo',
          workspaceRoot: '/repo/__worktrees',
          baseBranch: 'main',
          baseCommit: 'abc123',
          profile: 'default',
          agent: 'claude',
          runtime: 'host',
        })
      ).ok,
      true,
    )
    const acquiredEnvironments: Array<{ leaseId: string; path: string }> = []
    const releasedEnvironments: Array<{ leaseId: string; discard: boolean }> = []
    const port = new TaskflowExecutionPort({
      facade,
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
      onWorkspaceAcquired: async (workspace, leaseId): Promise<void> => {
        acquiredEnvironments.push({ leaseId, path: workspace.path })
      },
      onWorkspaceReleased: async (leaseId, discard): Promise<void> => {
        releasedEnvironments.push({ leaseId, discard })
      },
    })
    const first = await port.acquireWorkspace({ kind: 'fork', executionKey: 'impl-a', branchSlug: 'bake-off/a' })
    const second = await port.acquireWorkspace({ kind: 'fork', executionKey: 'impl-b', branchSlug: 'bake-off/b' })
    assert.notEqual(first.cwd, second.cwd)
    assert.equal(first.baseCommit, 'abc123')
    await port.releaseWorkspace(first.leaseId)
    await port.releaseWorkspace(second.leaseId, { discard: true })
    assert.deepEqual(
      acquiredEnvironments,
      [first, second].map((workspace) => ({ leaseId: workspace.leaseId, path: workspace.cwd })),
    )
    assert.deepEqual(releasedEnvironments, [
      { leaseId: first.leaseId, discard: false },
      { leaseId: second.leaseId, discard: true },
    ])
    const cleanupFailurePort = new TaskflowExecutionPort({
      facade,
      runId: 'run_01',
      projectRoot: '/repo',
      workspaceRoot: '/repo/__worktrees',
      profile: 'default',
      agent: 'claude',
      runtime: 'host',
      onWorkspaceReleased: async (): Promise<void> => {
        throw new Error('environment cleanup failed')
      },
    })
    const third = await cleanupFailurePort.acquireWorkspace({ kind: 'fork', executionKey: 'impl-c' })
    await assert.rejects(() => cleanupFailurePort.releaseWorkspace(third.leaseId), /environment cleanup failed/)
    assert.ok(store.listLeases('run_01').every((lease) => lease.status === 'released' || lease.status === 'preserved'))
  })
})
