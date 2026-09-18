import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AgentPermissionMode,
  type AgentTransport,
  type JsonValue,
  JsonValueSchema,
  type StdioMcpServer,
} from 'portta-contracts/taskflow'
import type {
  CreateRunRecord,
  ExecutionRecord,
  RunEventRecord,
  RunRecord,
  WorkflowSnapshotRecord,
} from 'portta-core/taskflow'
import { APP_SLUG } from 'portta-core/taskflow/config'
import type { RunStore } from '../adapters/run-store.ts'
import type { DirectSessionPort } from './direct-session-port.ts'
import type { RunEnvironmentPort } from './run-environment-port.ts'
import type { WorkflowEventBridge } from './workflow-event-bridge.ts'
import type { WorkflowRunHandle, WorkflowRunner } from './workflow-runner.ts'
import { type ProvisionWorkspaceInput, type WorkspaceFacade, workspaceBindingFromRun } from './workspace-facade.ts'

export interface CreateDirectRunInput extends Omit<ProvisionWorkspaceInput, 'runId'> {
  id: string
  projectId: string
  input: JsonValue
  operationId: string
  harness: string
  provider: string | null
  model: string | null
  profile: string
  transport?: AgentTransport
  permissionMode?: AgentPermissionMode
  mcpServers?: StdioMcpServer[]
}

export interface CreateWorkflowRunInput extends Omit<ProvisionWorkspaceInput, 'runId'> {
  id: string
  projectId: string
  input: JsonValue
  operationId: string
  snapshot: WorkflowSnapshotRecord
  dataRoot: string
  fake?: boolean
  transport?: AgentTransport
  permissionMode?: AgentPermissionMode
  mcpServers?: StdioMcpServer[]
}

export type DirectRunResult =
  | { ok: true; run: RunRecord; replayed: boolean }
  | {
      ok: false
      reason:
        | 'branch_conflict'
        | 'workspace_path_conflict'
        | 'workspace_provision_failed'
        | 'environment_unavailable'
        | 'environment_selection_required'
        | 'environment_trust_required'
        | 'session_start_failed'
        | 'session_resume_failed'
        | 'session_cancel_failed'
        | 'not_found'
        | 'capability_unavailable'
        | 'invalid_run_state'
        | 'invalid_transition'
        | 'checkout_busy'
        | 'dirty_workspace'
        | 'detached_head'
    }

export type WorkflowRunResult =
  | { ok: true; run: RunRecord; replayed: boolean }
  | {
      ok: false
      reason:
        | 'branch_conflict'
        | 'workspace_path_conflict'
        | 'workspace_provision_failed'
        | 'environment_unavailable'
        | 'environment_selection_required'
        | 'environment_trust_required'
        | 'workflow_runner_unavailable'
        | 'workflow_start_failed'
        | 'workflow_resume_failed'
        | 'not_found'
        | 'invalid_run_state'
        | 'invalid_transition'
        | 'workspace_unavailable'
        | 'checkout_busy'
        | 'dirty_workspace'
        | 'detached_head'
    }

function provisioningReason(
  reason: string,
):
  | 'branch_conflict'
  | 'workspace_path_conflict'
  | 'checkout_busy'
  | 'dirty_workspace'
  | 'detached_head'
  | 'workspace_provision_failed' {
  return reason === 'branch_conflict' ||
    reason === 'workspace_path_conflict' ||
    reason === 'checkout_busy' ||
    reason === 'dirty_workspace' ||
    reason === 'detached_head'
    ? reason
    : 'workspace_provision_failed'
}

function eventData(event: RunEventRecord): Record<string, unknown> | null {
  const payload =
    typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload) ? event.payload : null
  const data =
    payload && typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data)
      ? payload.data
      : null
  return data
}

export interface RunServiceDependencies {
  store: RunStore
  workspaces: WorkspaceFacade
  directSessions: DirectSessionPort
  environments?: RunEnvironmentPort
  workflowRunner?: WorkflowRunner
  workflowEvents?: WorkflowEventBridge
  eventPublisher?: { publish(event: RunEventRecord): void }
  workflowOperationsActive?: (runId: string) => Promise<boolean>
  now?: () => Date
}

interface ActiveWorkflow {
  handle: WorkflowRunHandle
  cancelling: boolean
  detaching: boolean
}

interface WorkflowConfig {
  dataRoot: string
  projectRoot: string
  workspaceRoot: string
  profile: string
  agent: string
  runtime: 'host' | 'docker'
  fake: boolean
  transport: AgentTransport
  permissionMode: AgentPermissionMode
  mcpServers: StdioMcpServer[]
}

function capabilitiesToJson(capabilities: {
  terminal: boolean
  interactiveInput: boolean
  interrupt: boolean
  resume: boolean
}): JsonValue {
  return {
    terminal: capabilities.terminal,
    interactiveInput: capabilities.interactiveInput,
    interrupt: capabilities.interrupt,
    resume: capabilities.resume,
  }
}

function checkpointToJson(checkpoint: Record<string, string> | null): JsonValue | null {
  return checkpoint === null ? null : { ...checkpoint }
}

function capabilityEnabled(value: JsonValue | null, capability: 'interrupt' | 'resume'): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value[capability] === true
}

function checkpointPid(value: JsonValue | null): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const pid = value.pid
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
}

function supportsProviderTranscript(harness: string): boolean {
  return harness === 'claude' || harness === 'codex'
}

export class RunService {
  private readonly now: () => Date
  private readonly activeWorkflows = new Map<string, ActiveWorkflow>()

  private readonly deps: RunServiceDependencies
  constructor(deps: RunServiceDependencies) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
  }

  async createDirect(input: CreateDirectRunInput): Promise<DirectRunResult> {
    const created = this.deps.store.createRun({
      id: input.id,
      projectId: input.projectId,
      mode: 'direct',
      input: input.input,
      status: 'queued',
      workspacePolicy: 'run',
      workspaceStrategy: input.workspace?.strategy ?? 'isolated_worktree',
      workspaceAccess: input.access ?? 'exclusive_write',
      profile: input.profile,
      operationId: input.operationId,
      createdAt: this.now().toISOString(),
      issueRef: input.issueRef ?? null,
    } satisfies CreateRunRecord)
    if (!created.ok) return created
    if (created.replayed) return { ok: true, run: created.run, replayed: true }

    let workspace: Awaited<ReturnType<WorkspaceFacade['provision']>>
    try {
      workspace = await this.deps.workspaces.provision({ ...input, runId: input.id })
    } catch {
      this.failProvisionedRun(input.id, 'Workspace provisioning failed')
      return { ok: false, reason: 'workspace_provision_failed' }
    }
    if (!workspace.ok) {
      this.failProvisionedRun(input.id, 'Workspace provisioning failed')
      return { ok: false, reason: provisioningReason(workspace.reason) }
    }
    if (workspace.workspace === null) {
      this.failProvisionedRun(input.id, 'Workspace provisioning failed')
      return { ok: false, reason: 'workspace_provision_failed' }
    }
    const environment = await this.prepareEnvironment(workspace.run, workspace.workspace, input.profile)
    if (!environment.ok) return environment
    try {
      const session = await this.deps.directSessions.start({
        run: environment.run,
        workspace: workspace.workspace,
        harness: input.harness,
        provider: input.provider,
        model: input.model,
        transport: input.transport ?? 'native',
        permissionMode: input.permissionMode ?? 'interactive',
        mcpServers: (input.mcpServers ?? []).map((server) => ({
          name: server.name,
          command: server.command,
          args: [...server.args],
          ...(server.env ? { env: { ...server.env } } : {}),
        })),
      })
      const execution = this.rootExecution(input, environment.run, session)
      const projected = this.deps.store.applyExecutionProjection({
        execution,
        cursor: { runId: input.id, sequence: 0, source: 'direct', updatedAt: this.now().toISOString() },
      })
      if (!projected.ok) throw new Error(`Unable to persist Direct execution: ${projected.reason}`)
      const running = this.deps.store.transitionRun(input.id, 'running', this.now().toISOString(), {
        startedAt: this.now().toISOString(),
      })
      if (!running.ok) throw new Error(`Unable to start Direct Run: ${running.reason}`)
      return { ok: true, run: running.run, replayed: false }
    } catch {
      this.failProvisionedRun(input.id, 'Direct session start failed')
      return { ok: false, reason: 'session_start_failed' }
    }
  }

  async createWorkflow(input: CreateWorkflowRunInput): Promise<WorkflowRunResult> {
    if (this.deps.workflowRunner === undefined || this.deps.workflowEvents === undefined) {
      return { ok: false, reason: 'workflow_runner_unavailable' }
    }
    const created = this.deps.store.createRun(
      {
        id: input.id,
        projectId: input.projectId,
        mode: 'workflow',
        input: input.input,
        status: 'queued',
        workspacePolicy: 'run',
        workspaceStrategy: input.workspace?.strategy ?? 'isolated_worktree',
        workspaceAccess: input.access ?? 'exclusive_write',
        workflowSnapshotId: input.snapshot.id,
        profile: input.profile,
        engineKind: 'workflow-engine',
        operationId: input.operationId,
        createdAt: this.now().toISOString(),
        issueRef: input.issueRef ?? null,
      } satisfies CreateRunRecord,
      input.snapshot,
    )
    if (!created.ok) return created
    if (created.replayed) return { ok: true, run: created.run, replayed: true }
    let workspace: Awaited<ReturnType<WorkspaceFacade['provision']>>
    try {
      workspace = await this.deps.workspaces.provision({ ...input, runId: input.id })
    } catch {
      this.failProvisionedRun(input.id, 'Workspace provisioning failed')
      return { ok: false, reason: 'workspace_provision_failed' }
    }
    if (!workspace.ok) {
      this.failProvisionedRun(input.id, 'Workspace provisioning failed')
      return { ok: false, reason: provisioningReason(workspace.reason) }
    }
    if (workspace.workspace === null) {
      this.failProvisionedRun(input.id, 'Workspace provisioning failed')
      return { ok: false, reason: 'workspace_provision_failed' }
    }
    const environment = await this.prepareEnvironment(workspace.run, workspace.workspace, input.profile)
    if (!environment.ok) return environment
    try {
      return this.startWorkflow(
        environment.run,
        input.snapshot,
        {
          dataRoot: input.dataRoot,
          projectRoot: input.projectRoot,
          workspaceRoot: input.workspaceRoot,
          profile: input.profile,
          agent: input.agent,
          runtime: input.runtime,
          fake: input.fake ?? false,
          transport: input.transport ?? 'native',
          permissionMode: input.permissionMode ?? 'workspace',
          mcpServers: input.mcpServers ?? [],
        },
        false,
      )
    } catch {
      this.failProvisionedRun(input.id, 'Workflow start failed')
      return { ok: false, reason: 'workflow_start_failed' }
    }
  }

  async cancel(runId: string): Promise<DirectRunResult> {
    const current = this.deps.store.getRun(runId)
    const execution = this.rootExecutionFor(runId)
    if (!current || !execution) return { ok: false, reason: 'not_found' }
    if (current.status !== 'running' && current.status !== 'waiting_input')
      return { ok: false, reason: 'invalid_run_state' }
    if (!capabilityEnabled(execution.capabilities, 'interrupt') || execution.sessionId === null) {
      return { ok: false, reason: 'capability_unavailable' }
    }
    try {
      await this.deps.directSessions.cancel(execution.sessionId)
    } catch {
      return { ok: false, reason: 'session_cancel_failed' }
    }
    this.projectExecution({ ...execution, status: 'cancelled', completedAt: this.now().toISOString() })
    const cancelled = this.deps.store.transitionRun(runId, 'cancelled', this.now().toISOString(), {
      completedAt: this.now().toISOString(),
    })
    this.deps.workspaces.releaseCheckout(runId)
    return cancelled.ok ? { ok: true, run: cancelled.run, replayed: false } : cancelled
  }

  async resume(runId: string): Promise<DirectRunResult> {
    const current = this.deps.store.getRun(runId)
    const execution = this.rootExecutionFor(runId)
    if (!current || !execution) return { ok: false, reason: 'not_found' }
    if (current.status !== 'interrupted') return { ok: false, reason: 'invalid_run_state' }
    if (!capabilityEnabled(execution.capabilities, 'resume') || execution.sessionId === null) {
      return { ok: false, reason: 'capability_unavailable' }
    }
    if (!this.deps.workspaces.acquireCheckout(runId)) return { ok: false, reason: 'checkout_busy' }
    const queued = this.deps.store.transitionRun(runId, 'queued', this.now().toISOString())
    if (!queued.ok) {
      this.deps.workspaces.releaseCheckout(runId)
      return queued
    }
    let session: Awaited<ReturnType<DirectSessionPort['resume']>>
    try {
      const workspace = workspaceBindingFromRun(queued.run)
      if (!workspace) {
        this.interrupt(queued.run)
        return { ok: false, reason: 'session_resume_failed' }
      }
      const environment = await this.prepareEnvironment(queued.run, workspace, queued.run.profile ?? 'default')
      if (!environment.ok) return environment
      const effective =
        typeof execution.effectiveConfig === 'object' &&
        execution.effectiveConfig !== null &&
        !Array.isArray(execution.effectiveConfig)
          ? execution.effectiveConfig
          : {}
      const permissionMode =
        effective.permissionMode === 'workspace' || effective.permissionMode === 'deny'
          ? effective.permissionMode
          : 'interactive'
      const mcpServers: StdioMcpServer[] = Array.isArray(effective.mcpServers)
        ? effective.mcpServers.flatMap((entry) => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
            if (typeof entry.name !== 'string' || typeof entry.command !== 'string' || !Array.isArray(entry.args))
              return []
            const env =
              typeof entry.env === 'object' && entry.env !== null && !Array.isArray(entry.env)
                ? Object.fromEntries(
                    Object.entries(entry.env).filter(
                      (candidate): candidate is [string, string] => typeof candidate[1] === 'string',
                    ),
                  )
                : undefined
            return [
              {
                name: entry.name,
                command: entry.command,
                args: entry.args.filter((arg): arg is string => typeof arg === 'string'),
                ...(env ? { env } : {}),
              },
            ]
          })
        : []
      session = await this.deps.directSessions.resume({
        sessionId: execution.sessionId,
        run: environment.run,
        workspace,
        harness: execution.harness,
        provider: execution.provider,
        model: execution.model,
        transport: effective.transport === 'acp' ? 'acp' : 'native',
        permissionMode,
        mcpServers,
      })
    } catch {
      this.interrupt(queued.run)
      return { ok: false, reason: 'session_resume_failed' }
    }
    this.projectExecution({
      ...execution,
      status: 'running',
      sessionId: session.sessionId,
      capabilities: capabilitiesToJson(session.capabilities),
      checkpoint: checkpointToJson(session.checkpoint),
      startedAt: this.now().toISOString(),
      completedAt: null,
    })
    const provisioning = this.deps.store.transitionRun(runId, 'provisioning', this.now().toISOString())
    if (!provisioning.ok) return provisioning
    const running = this.deps.store.transitionRun(runId, 'running', this.now().toISOString())
    return running.ok ? { ok: true, run: running.run, replayed: false } : running
  }

  async respondPermission(runId: string, requestId: string, optionId: string | null): Promise<DirectRunResult> {
    const current = this.deps.store.getRun(runId)
    const execution = this.rootExecutionFor(runId)
    if (!current || !execution) return { ok: false, reason: 'not_found' }
    if (
      current.status !== 'waiting_input' ||
      execution.sessionId === null ||
      !this.deps.directSessions.respondPermission
    )
      return { ok: false, reason: 'invalid_run_state' }
    try {
      await this.deps.directSessions.respondPermission(execution.sessionId, requestId, optionId)
      await this.syncDirectSessionEvents(current, execution, execution.sessionId)
    } catch {
      return { ok: false, reason: 'invalid_run_state' }
    }
    const running = this.deps.store.transitionRun(runId, 'running', this.now().toISOString())
    return running.ok ? { ok: true, run: running.run, replayed: false } : running
  }

  async resumeWorkflow(runId: string): Promise<WorkflowRunResult> {
    if (this.deps.workflowRunner === undefined || this.deps.workflowEvents === undefined) {
      return { ok: false, reason: 'workflow_runner_unavailable' }
    }
    const run = this.deps.store.getRun(runId)
    const snapshot = this.deps.store.getWorkflowSnapshot(runId)
    const control = this.workflowControlFor(runId)
    if (run === null || snapshot === null || control === null) return { ok: false, reason: 'not_found' }
    if (run.status !== 'interrupted') return { ok: false, reason: 'invalid_run_state' }
    if (run.worktreePath === null || this.deps.workspaces.reconcile(runId, control.projectRoot) !== 'attached') {
      return { ok: false, reason: 'workspace_unavailable' }
    }
    if (!this.deps.workspaces.acquireCheckout(runId)) return { ok: false, reason: 'checkout_busy' }
    const queued = this.deps.store.transitionRun(runId, 'queued', this.now().toISOString())
    if (!queued.ok) {
      this.deps.workspaces.releaseCheckout(runId)
      return queued
    }
    const provisioning = this.deps.store.transitionRun(runId, 'provisioning', this.now().toISOString())
    if (!provisioning.ok) {
      this.deps.workspaces.releaseCheckout(runId)
      return provisioning
    }
    try {
      const workspace = workspaceBindingFromRun(provisioning.run)
      if (!workspace) return { ok: false, reason: 'workspace_unavailable' }
      const environment = await this.prepareEnvironment(
        provisioning.run,
        workspace,
        provisioning.run.profile ?? 'default',
      )
      if (!environment.ok) return environment
      return this.startWorkflow(environment.run, snapshot, control, true)
    } catch {
      this.failProvisionedRun(runId, 'Workflow resume failed')
      return { ok: false, reason: 'workflow_resume_failed' }
    }
  }

  async cancelWorkflow(runId: string): Promise<WorkflowRunResult> {
    const run = this.deps.store.getRun(runId)
    const active = this.activeWorkflows.get(runId)
    if (run === null || active === undefined) return { ok: false, reason: 'not_found' }
    if (run.status !== 'running' && run.status !== 'waiting_input') return { ok: false, reason: 'invalid_run_state' }
    active.cancelling = true
    await active.handle.cancel()
    const updated = this.deps.store.getRun(runId)
    return updated ? { ok: true, run: updated, replayed: false } : { ok: false, reason: 'not_found' }
  }

  async reconcileWorkflow(runId: string): Promise<RunRecord | null> {
    const run = this.deps.store.getRun(runId)
    if (run === null || run.mode !== 'workflow' || (run.status !== 'running' && run.status !== 'waiting_input'))
      return run
    if (run.engineRunId !== null && this.deps.workflowRunner?.inspect(run.engineRunId)?.active) return run
    const control = this.workflowControlFor(runId)
    if (control?.transport === 'acp' && (await this.deps.workflowOperationsActive?.(runId))) return run
    if (run.engineRunId !== null && control !== null) {
      const result = await this.completedResult(run.engineRunId, control.dataRoot)
      if (result !== null) {
        const completed = this.deps.store.transitionRun(runId, 'completed', this.now().toISOString(), {
          result,
          completedAt: this.now().toISOString(),
        })
        this.deps.workspaces.releaseCheckout(runId)
        return completed.ok ? completed.run : this.deps.store.getRun(runId)
      }
    }
    const interrupted = this.deps.store.transitionRun(runId, 'interrupted', this.now().toISOString(), {
      error: 'Workflow worker is no longer active',
      completedAt: this.now().toISOString(),
    })
    this.deps.workspaces.releaseCheckout(runId)
    return interrupted.ok ? interrupted.run : this.deps.store.getRun(runId)
  }

  async reconcile(runId: string, projectRoot: string): Promise<RunRecord | null> {
    const run = this.deps.store.getRun(runId)
    if (run === null || (run.status !== 'running' && run.status !== 'waiting_input')) return run
    const execution = this.rootExecutionFor(runId)
    const sessionId = execution?.sessionId
    if (this.deps.workspaces.reconcile(runId, projectRoot) !== 'attached' || execution === null || sessionId == null) {
      return this.interrupt(run)
    }
    const activeExecution = execution
    await this.syncDirectSessionEvents(run, activeExecution, sessionId)
    const state = await this.deps.directSessions.inspect(sessionId)
    if (state === null) return this.interrupt(run)
    if (!state.active) {
      const completedAt = this.now().toISOString()
      if (state.terminal?.status === 'completed') {
        this.projectExecution({
          ...activeExecution,
          status: 'completed',
          output: state.terminal.result,
          completedAt,
        })
        const completed = this.deps.store.transitionRun(runId, 'completed', completedAt, {
          result: state.terminal.result,
          completedAt,
        })
        this.deps.workspaces.releaseCheckout(runId)
        return completed.ok ? completed.run : this.deps.store.getRun(runId)
      }
      if (state.terminal?.status === 'failed') {
        this.projectExecution({ ...activeExecution, status: 'failed', error: state.terminal.error, completedAt })
        const failed = this.deps.store.transitionRun(runId, 'failed', completedAt, {
          error: state.terminal.error ?? 'ACP agent failed',
          completedAt,
        })
        this.deps.workspaces.releaseCheckout(runId)
        return failed.ok ? failed.run : this.deps.store.getRun(runId)
      }
      if (state.terminal?.status === 'cancelled') {
        this.projectExecution({ ...activeExecution, status: 'cancelled', completedAt })
        const cancelled = this.deps.store.transitionRun(runId, 'cancelled', completedAt, { completedAt })
        this.deps.workspaces.releaseCheckout(runId)
        return cancelled.ok ? cancelled.run : this.deps.store.getRun(runId)
      }
      return this.interrupt(run)
    }
    this.projectExecution({
      ...activeExecution,
      capabilities: capabilitiesToJson(state.capabilities),
      checkpoint: checkpointToJson(state.checkpoint),
    })
    if (run.status !== state.activity) {
      const transitioned = this.deps.store.transitionRun(runId, state.activity, this.now().toISOString())
      if (transitioned.ok) {
        this.publishDirectStatus(transitioned.run, activeExecution, state.activity)
        return transitioned.run
      }
    }
    return this.deps.store.getRun(runId)
  }

  private async syncDirectSessionEvents(run: RunRecord, execution: ExecutionRecord, sessionId: string): Promise<void> {
    if (!this.deps.directSessions.events) return
    const prior = this.deps.store.listEvents(run.id)
    const after = prior.reduce((cursor, event) => {
      if (!event.type.startsWith('acp.')) return cursor
      const data = eventData(event)
      return typeof data?.supervisorSequence === 'number' ? Math.max(cursor, data.supervisorSequence) : cursor
    }, 0)
    const events = await this.deps.directSessions.events(sessionId, after)
    for (const source of events) {
      const sequence = (this.deps.store.getEventCursor(run.id)?.sequence ?? 0) + 1
      const event: RunEventRecord = {
        id: `event_${run.id}_acp_${source.sequence}`,
        runId: run.id,
        executionId: execution.id,
        sessionId,
        sequence,
        type: `acp.${source.type}`,
        timestamp: source.timestamp,
        source: 'harness',
        payload: {
          version: 1,
          data: { supervisorSequence: source.sequence, event: source.payload },
        },
      }
      const appended = this.deps.store.appendEvent({
        event,
        cursor: { runId: run.id, sequence, source: 'acp', updatedAt: source.timestamp },
      })
      if (appended.ok && !appended.replayed) this.deps.eventPublisher?.publish(event)
    }
  }

  private publishDirectStatus(run: RunRecord, execution: ExecutionRecord, status: 'running' | 'waiting_input'): void {
    const sequence = (this.deps.store.getEventCursor(run.id)?.sequence ?? 0) + 1
    const timestamp = this.now().toISOString()
    const event: RunEventRecord = {
      id: `event_${run.id}_${sequence}`,
      runId: run.id,
      executionId: execution.id,
      sessionId: execution.sessionId,
      sequence,
      type: 'direct.status',
      timestamp,
      source: 'session',
      payload: { version: 1, data: { status } },
    }
    const appended = this.deps.store.appendEvent({
      event,
      cursor: { runId: run.id, sequence, source: 'session', updatedAt: timestamp },
    })
    if (appended.ok && !appended.replayed) this.deps.eventPublisher?.publish(event)
  }

  async reconcileProject(projectId: string, projectRoot: string): Promise<RunRecord[]> {
    const activeRuns = this.deps.store
      .listRuns(projectId)
      .filter((run) => run.status === 'running' || run.status === 'waiting_input')
    return Promise.all(
      activeRuns.map(async (run) =>
        run.mode === 'workflow' ? this.reconcileWorkflow(run.id) : this.reconcile(run.id, projectRoot),
      ),
    ).then((runs) => runs.filter((run): run is RunRecord => run !== null))
  }

  async shutdownProject(projectId: string, projectRoot: string): Promise<void> {
    const runs = this.deps.store
      .listRuns(projectId)
      .filter((run) => run.status === 'running' || run.status === 'waiting_input')
    await Promise.all(
      runs.map(async (run): Promise<void> => {
        if (run.mode === 'direct') {
          await this.reconcile(run.id, projectRoot)
          return
        }
        const active = this.activeWorkflows.get(run.id)
        const control = this.workflowControlFor(run.id)
        if (active === undefined || control === null || run.engineRunId === null) {
          await this.reconcileWorkflow(run.id)
          return
        }
        this.projectWorkflowControl(run, run.engineRunId, active.handle, control, active.handle.cursor)
        if (control.transport === 'acp' && active.handle.detach) {
          active.detaching = true
          await active.handle.detach()
          return
        }
        active.cancelling = true
        await active.handle.cancel()
      }),
    )
  }

  private rootExecution(
    input: CreateDirectRunInput,
    run: RunRecord,
    session: Awaited<ReturnType<DirectSessionPort['start']>>,
  ): ExecutionRecord {
    return {
      id: `execution_${input.id}_root`,
      runId: input.id,
      nodeKey: 'direct:root',
      label: 'Direct session',
      phase: null,
      attempt: 1,
      harness: input.harness,
      provider: input.provider,
      model: input.model,
      effectiveConfig: {
        profile: input.profile,
        transport: input.transport ?? 'native',
        permissionMode: input.permissionMode ?? 'interactive',
        mcpServers: (input.mcpServers ?? []).map((server) => ({
          name: server.name,
          command: server.command,
          args: [...server.args],
          ...(server.env ? { env: { ...server.env } } : {}),
        })),
        ...(input.transport !== 'acp' && supportsProviderTranscript(input.harness)
          ? { transcriptSource: 'provider_session' }
          : {}),
      },
      workspaceId: run.workspaceId,
      input: input.input,
      output: null,
      status: 'running',
      usage: null,
      error: null,
      sessionId: session.sessionId,
      capabilities: capabilitiesToJson(session.capabilities),
      checkpoint: checkpointToJson(session.checkpoint),
      startedAt: this.now().toISOString(),
      completedAt: null,
    }
  }

  private async prepareEnvironment(
    run: RunRecord,
    workspace: Parameters<RunEnvironmentPort['prepare']>[0]['workspace'],
    profile: string,
  ): Promise<
    | { ok: true; run: RunRecord }
    | {
        ok: false
        reason: 'environment_unavailable' | 'environment_selection_required' | 'environment_trust_required'
      }
  > {
    if (!this.deps.environments) return { ok: true, run }
    const prepared = await this.deps.environments.prepare({ run, workspace, profile })
    if (!prepared.ok) {
      if (prepared.environmentId) {
        this.deps.store.setEnvironment(run.id, prepared.environmentId, this.now().toISOString())
      }
      this.recordEnvironmentEvent(run, prepared)
      this.failProvisionedRun(run.id, `Environment preparation failed: ${prepared.diagnostics.join('; ')}`)
      const reason =
        prepared.reason === 'trust_required'
          ? 'environment_trust_required'
          : prepared.reason === 'selection_required'
            ? 'environment_selection_required'
            : 'environment_unavailable'
      return { ok: false, reason }
    }
    const attached = this.deps.store.setEnvironment(run.id, prepared.environmentId, this.now().toISOString())
    if (!attached) {
      this.failProvisionedRun(run.id, 'Environment could not be attached to Run')
      return { ok: false, reason: 'environment_unavailable' }
    }
    return { ok: true, run: attached }
  }

  private recordEnvironmentEvent(
    run: RunRecord,
    failure: Extract<Awaited<ReturnType<RunEnvironmentPort['prepare']>>, { ok: false }>,
  ): void {
    const sequence = (this.deps.store.getEventCursor(run.id)?.sequence ?? 0) + 1
    const timestamp = this.now().toISOString()
    const event: RunEventRecord = {
      id: `event_${run.id}_${sequence}`,
      runId: run.id,
      executionId: null,
      sessionId: null,
      sequence,
      type: failure.reason === 'trust_required' ? 'environment.trust_required' : 'environment.failed',
      timestamp,
      source: 'system',
      payload: {
        version: 1,
        data: {
          reason: failure.reason,
          diagnostics: failure.diagnostics,
          environmentId: failure.environmentId ?? null,
        },
      },
    }
    const appended = this.deps.store.appendEvent({
      event,
      cursor: { runId: run.id, sequence, source: 'environment', updatedAt: timestamp },
    })
    if (appended.ok && !appended.replayed) this.deps.eventPublisher?.publish(event)
  }

  private startWorkflow(
    run: RunRecord,
    snapshot: WorkflowSnapshotRecord,
    control: WorkflowConfig,
    resume: boolean,
  ): WorkflowRunResult {
    const runner = this.deps.workflowRunner
    const events = this.deps.workflowEvents
    if (runner === undefined || events === undefined || run.worktreePath === null || run.workspaceId === null) {
      return { ok: false, reason: 'workflow_runner_unavailable' }
    }
    const engineRunId = run.engineRunId ?? `engine_${run.id}`
    const currentCursor = this.deps.store.getEventCursor(run.id)?.sequence ?? 0
    const handle = runner.run(
      {
        runId: run.id,
        engineRunId,
        cursor: currentCursor,
        spec: {
          cwd: run.worktreePath,
          source: snapshot.source,
          args: run.input,
          dataRoot: control.dataRoot,
          externalContext: { owner: APP_SLUG, projectId: run.projectId, runId: run.id, workspaceId: run.workspaceId },
          fake: control.fake,
          resume,
          projectRoot: control.projectRoot,
          workspaceRoot: control.workspaceRoot,
          profile: control.profile,
          agent: control.agent,
          runtime: control.runtime,
          ...(run.environmentId ? { environmentId: run.environmentId } : {}),
          agentRuntime: {
            transport: control.transport,
            permissionMode: control.permissionMode,
            mcpServers: control.mcpServers.map((server) => ({
              name: server.name,
              command: server.command,
              args: [...server.args],
              ...(server.env ? { env: { ...server.env } } : {}),
            })),
          },
        },
      },
      {
        onMessage: (message): void => {
          if (message.type === 'event')
            events.apply(run.id, message.cursor, message.event, { engineRunId, dataRoot: control.dataRoot })
          if (message.type === 'heartbeat') this.recordWorkflowHeartbeat(run.id, engineRunId, message.cursor)
        },
      },
    )
    this.projectWorkflowControl(run, engineRunId, handle, control, currentCursor)
    const running = this.deps.store.transitionRun(run.id, 'running', this.now().toISOString(), {
      engineRunId,
      startedAt: run.startedAt ?? this.now().toISOString(),
      error: null,
      completedAt: null,
    })
    if (!running.ok) throw new Error(`Unable to start Workflow Run: ${running.reason}`)
    const active: ActiveWorkflow = { handle, cancelling: false, detaching: false }
    this.activeWorkflows.set(run.id, active)
    void handle.done.then((terminal): void => {
      this.completeWorkflow(run.id, engineRunId, active, terminal)
    })
    return { ok: true, run: running.run, replayed: false }
  }

  private completeWorkflow(
    runId: string,
    engineRunId: string,
    active: ActiveWorkflow,
    terminal: Awaited<WorkflowRunHandle['done']>,
  ): void {
    if (this.activeWorkflows.get(runId) === active) this.activeWorkflows.delete(runId)
    const run = this.deps.store.getRun(runId)
    if (active.detaching) return
    if (run === null || run.engineRunId !== engineRunId || (run.status !== 'running' && run.status !== 'waiting_input'))
      return
    const root = this.workflowControlFor(runId)
    if (root !== null)
      this.projectWorkflowControl(
        run,
        engineRunId,
        active.handle,
        root,
        terminal.cursor,
        terminal.type === 'completed' ? 'completed' : active.cancelling ? 'cancelled' : 'failed',
        terminal.type === 'completed' ? { resultPath: join(root.dataRoot, 'runs', engineRunId, 'result.json') } : null,
      )
    const completedAt = this.now().toISOString()
    if (terminal.type === 'completed') {
      const result = JsonValueSchema.safeParse(terminal.result)
      this.deps.store.transitionRun(runId, 'completed', completedAt, {
        result: result.success ? result.data : null,
        completedAt,
      })
      this.deps.workspaces.releaseCheckout(runId)
      return
    }
    const status = active.cancelling ? 'interrupted' : 'failed'
    this.deps.store.transitionRun(runId, status, completedAt, { error: terminal.error, completedAt })
    this.deps.workspaces.releaseCheckout(runId)
  }

  private projectWorkflowControl(
    run: RunRecord,
    engineRunId: string,
    handle: WorkflowRunHandle,
    config: WorkflowConfig,
    cursor: number,
    status: ExecutionRecord['status'] = 'running',
    output: JsonValue | null = null,
  ): void {
    const existing = this.deps.store.getExecutions(run.id).find((execution) => execution.nodeKey === 'workflow:run')
    const timestamp = this.now().toISOString()
    const projected = this.deps.store.applyExecutionProjection({
      execution: {
        id: existing?.id ?? `execution_${run.id}_workflow`,
        runId: run.id,
        nodeKey: 'workflow:run',
        label: 'Workflow engine',
        phase: null,
        attempt: 1,
        harness: 'workflow-engine',
        provider: null,
        model: null,
        effectiveConfig: {
          dataRoot: config.dataRoot,
          projectRoot: config.projectRoot,
          workspaceRoot: config.workspaceRoot,
          profile: config.profile,
          agent: config.agent,
          runtime: config.runtime,
          fake: config.fake,
          transport: config.transport,
          permissionMode: config.permissionMode,
          mcpServers: config.mcpServers.map((server) => ({
            name: server.name,
            command: server.command,
            args: [...server.args],
          })),
        },
        workspaceId: run.workspaceId,
        input: null,
        output,
        status,
        usage: null,
        error: null,
        sessionId: null,
        capabilities: { cancel: true, resume: true },
        checkpoint: { engineRunId, pid: handle.pid, cursor },
        startedAt: existing?.startedAt ?? timestamp,
        completedAt: status === 'running' ? null : timestamp,
      },
      cursor: { runId: run.id, sequence: cursor, source: 'workflow', updatedAt: timestamp },
    })
    if (!projected.ok) throw new Error(`Unable to persist Workflow control: ${projected.reason}`)
  }

  private recordWorkflowHeartbeat(runId: string, engineRunId: string, cursor: number): void {
    const execution = this.deps.store.getExecutions(runId).find((entry) => entry.nodeKey === 'workflow:run')
    if (execution === undefined) return
    const timestamp = this.now().toISOString()
    const pid = checkpointPid(execution.checkpoint)
    const projected = this.deps.store.applyExecutionProjection({
      execution: {
        ...execution,
        checkpoint: {
          engineRunId,
          ...(pid === null ? {} : { pid }),
          cursor,
          lastHeartbeatAt: timestamp,
        },
      },
      cursor: { runId, sequence: cursor, source: 'workflow', updatedAt: timestamp },
    })
    if (!projected.ok) throw new Error(`Unable to persist Workflow heartbeat: ${projected.reason}`)
  }

  private workflowControlFor(runId: string): WorkflowConfig | null {
    const execution = this.deps.store.getExecutions(runId).find((entry) => entry.nodeKey === 'workflow:run')
    if (
      execution === undefined ||
      typeof execution.effectiveConfig !== 'object' ||
      execution.effectiveConfig === null ||
      Array.isArray(execution.effectiveConfig)
    )
      return null
    const dataRoot = execution.effectiveConfig.dataRoot
    const projectRoot = execution.effectiveConfig.projectRoot
    const workspaceRoot = execution.effectiveConfig.workspaceRoot
    const profile = execution.effectiveConfig.profile
    const agent = execution.effectiveConfig.agent
    const runtime = execution.effectiveConfig.runtime
    const fake = execution.effectiveConfig.fake
    const transport = execution.effectiveConfig.transport
    const permissionMode = execution.effectiveConfig.permissionMode
    const rawMcpServers = execution.effectiveConfig.mcpServers
    const mcpServers: StdioMcpServer[] = Array.isArray(rawMcpServers)
      ? rawMcpServers.flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
          if (typeof entry.name !== 'string' || typeof entry.command !== 'string' || !Array.isArray(entry.args))
            return []
          const args = entry.args.filter((arg): arg is string => typeof arg === 'string')
          const env =
            typeof entry.env === 'object' && entry.env !== null && !Array.isArray(entry.env)
              ? Object.fromEntries(
                  Object.entries(entry.env).filter(
                    (candidate): candidate is [string, string] => typeof candidate[1] === 'string',
                  ),
                )
              : undefined
          return [{ name: entry.name, command: entry.command, args, ...(env ? { env } : {}) }]
        })
      : []
    return typeof dataRoot === 'string' &&
      typeof projectRoot === 'string' &&
      typeof workspaceRoot === 'string' &&
      typeof profile === 'string' &&
      typeof agent === 'string' &&
      (runtime === 'host' || runtime === 'docker') &&
      typeof fake === 'boolean' &&
      (transport === 'native' || transport === 'acp') &&
      (permissionMode === 'interactive' || permissionMode === 'workspace' || permissionMode === 'deny')
      ? { dataRoot, projectRoot, workspaceRoot, profile, agent, runtime, fake, transport, permissionMode, mcpServers }
      : null
  }

  private async completedResult(engineRunId: string, dataRoot: string): Promise<JsonValue | null> {
    try {
      const result = JsonValueSchema.safeParse(
        JSON.parse(await readFile(join(dataRoot, 'runs', engineRunId, 'result.json'), 'utf8')),
      )
      return result.success ? result.data : null
    } catch {
      return null
    }
  }

  private rootExecutionFor(runId: string): ExecutionRecord | null {
    return this.deps.store.getExecutions(runId).find((execution) => execution.nodeKey === 'direct:root') ?? null
  }

  private projectExecution(execution: ExecutionRecord): void {
    const cursor = this.deps.store.getEventCursor(execution.runId)
    const result = this.deps.store.applyExecutionProjection({
      execution,
      cursor: {
        runId: execution.runId,
        sequence: cursor?.sequence ?? 0,
        source: 'direct',
        updatedAt: this.now().toISOString(),
      },
    })
    if (!result.ok) throw new Error(`Unable to update Direct execution: ${result.reason}`)
  }

  private failProvisionedRun(runId: string, error: string): void {
    this.deps.store.transitionRun(runId, 'failed', this.now().toISOString(), {
      error,
      completedAt: this.now().toISOString(),
    })
    this.deps.workspaces.releaseCheckout(runId)
  }

  private interrupt(run: RunRecord): RunRecord | null {
    const execution = this.rootExecutionFor(run.id)
    if (execution?.status === 'running') {
      this.projectExecution({
        ...execution,
        status: 'failed',
        error: 'Direct session is no longer active',
        completedAt: this.now().toISOString(),
      })
    }
    const interrupted = this.deps.store.transitionRun(run.id, 'interrupted', this.now().toISOString())
    this.deps.workspaces.releaseCheckout(run.id)
    return interrupted.ok ? interrupted.run : this.deps.store.getRun(run.id)
  }
}
