export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const WORKSPACE_STRATEGIES = ['isolated_worktree', 'new_branch', 'current_branch'] as const
export type WorkspaceStrategy = (typeof WORKSPACE_STRATEGIES)[number]

export const WORKSPACE_ACCESSES = ['shared_read', 'exclusive_write'] as const
export type WorkspaceAccess = (typeof WORKSPACE_ACCESSES)[number]

const runStatuses = [
  'queued',
  'provisioning',
  'running',
  'waiting_input',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const

const executionStatuses = ['queued', 'running', 'completed', 'failed', 'skipped', 'cancelled'] as const

export type RunMode = 'workflow' | 'direct'
export type RunStatus = (typeof runStatuses)[number]
export type ExecutionStatus = (typeof executionStatuses)[number]
export type WorkspacePolicy = 'none' | 'run'
export type WorkspaceLeaseKind = 'run' | 'fork'
export type WorkspaceLeaseStatus = 'reserved' | 'active' | 'released' | 'preserved'

export interface RunRecord {
  id: string
  projectId: string
  mode: RunMode
  input: JsonValue
  status: RunStatus
  workspacePolicy: WorkspacePolicy
  workspaceStrategy?: WorkspaceStrategy
  workspaceAccess?: WorkspaceAccess
  workflowSnapshotId: string | null
  environmentId: string | null
  workspaceId: string | null
  worktreePath: string | null
  canonicalWorkspacePath: string | null
  branch: string | null
  baseBranch: string | null
  baseCommit: string | null
  profile: string | null
  engineKind: string | null
  engineRunId: string | null
  error: string | null
  result: JsonValue | null
  operationId: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  /** The issue this Run is for, when one started it. A ref, never a copy. */
  issueRef: string | null
}

export interface CreateRunRecord {
  id: string
  projectId: string
  mode: RunMode
  input: JsonValue
  status: RunStatus
  workspacePolicy: WorkspacePolicy
  workspaceStrategy?: WorkspaceStrategy
  workspaceAccess?: WorkspaceAccess
  workflowSnapshotId?: string | null
  environmentId?: string | null
  workspaceId?: string | null
  worktreePath?: string | null
  canonicalWorkspacePath?: string | null
  branch?: string | null
  baseBranch?: string | null
  baseCommit?: string | null
  profile?: string | null
  engineKind?: string | null
  engineRunId?: string | null
  error?: string | null
  result?: JsonValue | null
  operationId: string
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  issueRef?: string | null
}

export interface WorkflowSnapshotRecord {
  id: string
  runId: string
  definitionId: string
  name: string
  description: string
  origin: 'builtin' | 'global' | 'project'
  path: string
  contentHash: string
  engineVersion: string
  keyVersion: string
  source: string
  metadata: JsonValue
  createdAt: string
}

export interface ExecutionRecord {
  id: string
  runId: string
  nodeKey: string
  label: string
  phase: string | null
  attempt: number
  harness: string
  provider: string | null
  model: string | null
  effectiveConfig: JsonValue
  workspaceId: string | null
  input: JsonValue | null
  output: JsonValue | null
  status: ExecutionStatus
  usage: JsonValue | null
  error: string | null
  sessionId: string | null
  capabilities: JsonValue | null
  checkpoint: JsonValue | null
  startedAt: string | null
  completedAt: string | null
}

export interface EventCursor {
  runId: string
  sequence: number
  source: string
  updatedAt: string
}

export interface RunEventRecord {
  id: string
  runId: string
  executionId: string | null
  sessionId: string | null
  sequence: number
  type: string
  timestamp: string
  source: 'run' | 'workflow' | 'harness' | 'session' | 'system'
  payload: JsonValue
}

export interface WorkspaceReservation {
  runId: string
  workspaceId: string
  worktreePath: string
  canonicalWorkspacePath: string
  branch: string
  baseBranch: string
  baseCommit: string
  strategy: WorkspaceStrategy
  access: WorkspaceAccess
  updatedAt: string
}

export interface CheckoutClaim {
  runId: string
  projectId: string
  canonicalPath: string
  access: WorkspaceAccess
  createdAt: string
}

export interface WorkspaceLeaseRecord {
  id: string
  runId: string
  executionId: string | null
  parentWorkspaceId: string
  kind: WorkspaceLeaseKind
  status: WorkspaceLeaseStatus
  workspaceId: string
  worktreePath: string
  canonicalWorkspacePath: string
  branch: string
  baseBranch: string
  baseCommit: string
  createdAt: string
  updatedAt: string
  releasedAt: string | null
}

export interface ChildLeaseReservation {
  id: string
  runId: string
  executionId?: string | null
  parentWorkspaceId: string
  workspaceId: string
  worktreePath: string
  canonicalWorkspacePath: string
  branch: string
  baseBranch: string
  baseCommit: string
  createdAt: string
}

export interface CreateRunResult {
  ok: true
  run: RunRecord
  replayed: boolean
}

export interface CreateRunConflict {
  ok: false
  reason: 'branch_conflict' | 'workspace_path_conflict'
}

export interface RunTransitionSuccess {
  ok: true
  run: RunRecord
}

export interface RunTransitionFailure {
  ok: false
  reason: 'not_found' | 'invalid_transition'
}

export interface WorkspaceReservationSuccess {
  ok: true
  run: RunRecord
  replayed: boolean
}

export interface WorkspaceReservationFailure {
  ok: false
  reason:
    | 'not_found'
    | 'invalid_run_state'
    | 'workspace_already_reserved'
    | 'branch_conflict'
    | 'workspace_path_conflict'
}

export interface ChildLeaseReservationSuccess {
  ok: true
  lease: WorkspaceLeaseRecord
  replayed: boolean
}

export interface ChildLeaseReservationFailure {
  ok: false
  reason: 'not_found' | 'parent_workspace_missing' | 'lease_conflict' | 'branch_conflict' | 'workspace_path_conflict'
}

export interface ProjectionUpdateSuccess {
  ok: true
}

export interface ProjectionUpdateFailure {
  ok: false
  reason: 'cursor_regression' | 'run_mismatch'
}

export interface EventAppendSuccess {
  ok: true
  replayed: boolean
}

export interface EventAppendFailure {
  ok: false
  reason: 'cursor_regression' | 'run_mismatch'
}

export const RUN_STATUS_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['provisioning', 'cancelled', 'failed', 'interrupted'],
  provisioning: ['running', 'failed', 'cancelled'],
  running: ['waiting_input', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting_input: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: ['queued'],
  cancelled: ['queued'],
  interrupted: ['queued', 'failed', 'cancelled'],
}

export function isRunTransitionAllowed(from: RunStatus, to: RunStatus): boolean {
  return RUN_STATUS_TRANSITIONS[from].includes(to)
}
