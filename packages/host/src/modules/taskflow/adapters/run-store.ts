import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { WorkspaceAccess } from 'portta-contracts/taskflow'
import { type JsonValue, JsonValueSchema } from 'portta-contracts/taskflow'
import {
  type CheckoutClaim,
  type ChildLeaseReservation,
  type ChildLeaseReservationFailure,
  type ChildLeaseReservationSuccess,
  type CreateRunConflict,
  type CreateRunRecord,
  type CreateRunResult,
  type EventAppendFailure,
  type EventAppendSuccess,
  type EventCursor,
  type ExecutionRecord,
  type ExecutionStatus,
  isRunTransitionAllowed,
  type ProjectionUpdateFailure,
  type ProjectionUpdateSuccess,
  type RunEventRecord,
  type RunMode,
  type RunRecord,
  type RunStatus,
  type RunTransitionFailure,
  type RunTransitionSuccess,
  type WorkflowSnapshotRecord,
  type WorkspaceLeaseKind,
  type WorkspaceLeaseRecord,
  type WorkspaceLeaseStatus,
  type WorkspacePolicy,
  type WorkspaceReservation,
  type WorkspaceReservationFailure,
  type WorkspaceReservationSuccess,
} from 'portta-core/taskflow'
import { globalPaths } from 'portta-core/taskflow/paths'
import { openDatabase } from './sqlite.ts'

interface RunRow {
  id: string
  project_id: string
  mode: string
  input_json: string
  status: string
  workspace_policy: string
  workspace_strategy: string | null
  workspace_access: string | null
  checkout_canonical_path: string | null
  checkout_branch: string | null
  workflow_snapshot_id: string | null
  environment_id: string | null
  workspace_id: string | null
  worktree_path: string | null
  canonical_workspace_path: string | null
  branch: string | null
  base_branch: string | null
  base_commit: string | null
  profile: string | null
  engine_kind: string | null
  engine_run_id: string | null
  error: string | null
  result_json: string | null
  operation_id: string
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  issue_ref: string | null
}

interface ExecutionRow {
  id: string
  run_id: string
  node_key: string
  label: string
  phase: string | null
  attempt: number
  harness: string
  provider: string | null
  model: string | null
  effective_config_json: string
  workspace_id: string | null
  input_json: string | null
  output_json: string | null
  status: string
  usage_json: string | null
  error: string | null
  session_id: string | null
  capabilities_json: string | null
  checkpoint_json: string | null
  started_at: string | null
  completed_at: string | null
}

interface WorkflowSnapshotRow {
  id: string
  run_id: string
  definition_id: string
  name: string
  description: string
  origin: 'builtin' | 'global' | 'project'
  path: string
  content_hash: string
  engine_version: string
  key_version: string
  source: string
  metadata_json: string
  created_at: string
}

interface EventCursorRow {
  run_id: string
  sequence: number
  source: string
  updated_at: string
}

interface RunEventRow {
  id: string
  run_id: string
  execution_id: string | null
  session_id: string | null
  sequence: number
  type: string
  timestamp: string
  source: 'run' | 'workflow' | 'harness' | 'session' | 'system'
  payload_json: string
}

interface WorkspaceLeaseRow {
  id: string
  run_id: string
  execution_id: string | null
  parent_workspace_id: string
  kind: string
  status: string
  workspace_id: string
  worktree_path: string
  canonical_workspace_path: string
  branch: string
  base_branch: string
  base_commit: string
  created_at: string
  updated_at: string
  released_at: string | null
}

interface ProjectionUpdate {
  execution: ExecutionRecord
  cursor: EventCursor
}

interface EventAppend {
  event: RunEventRecord
  execution?: ExecutionRecord
  cursor: EventCursor
}

export interface RunStore {
  createRun(input: CreateRunRecord, snapshot?: WorkflowSnapshotRecord): CreateRunResult | CreateRunConflict
  getRun(runId: string): RunRecord | null
  listRuns(projectId: string): RunRecord[]
  getWorkflowSnapshot(runId: string): WorkflowSnapshotRecord | null
  getExecutions(runId: string): ExecutionRecord[]
  getExecution(executionId: string): ExecutionRecord | null
  getEventCursor(runId: string): EventCursor | null
  listEvents(runId: string, after?: number): RunEventRecord[]
  reserveWorkspace(input: WorkspaceReservation): WorkspaceReservationSuccess | WorkspaceReservationFailure
  reserveChildLease(input: ChildLeaseReservation): ChildLeaseReservationSuccess | ChildLeaseReservationFailure
  getLease(leaseId: string): WorkspaceLeaseRecord | null
  listLeases(runId: string): WorkspaceLeaseRecord[]
  updateLeaseStatus(
    leaseId: string,
    status: WorkspaceLeaseStatus,
    updatedAt: string,
    releasedAt?: string | null,
  ): WorkspaceLeaseRecord | null
  deleteLease(leaseId: string): void
  acquireCheckoutClaim(
    input: CheckoutClaim,
  ): { ok: true } | { ok: false; reason: 'checkout_busy'; conflictingRunIds: string[] }
  releaseCheckoutClaim(runId: string): void
  setEnvironment(runId: string, environmentId: string, updatedAt: string): RunRecord | null
  listCheckoutClaims(projectId: string, canonicalPath: string): CheckoutClaim[]
  transitionRun(
    runId: string,
    nextStatus: RunStatus,
    updatedAt: string,
    updates?: Partial<Pick<RunRecord, 'error' | 'result' | 'startedAt' | 'completedAt' | 'engineRunId'>>,
  ): RunTransitionSuccess | RunTransitionFailure
  applyExecutionProjection(input: ProjectionUpdate): ProjectionUpdateSuccess | ProjectionUpdateFailure
  appendEvent(input: EventAppend): EventAppendSuccess | EventAppendFailure
  close(): void
}

let sharedRunStore: RunStore | null = null

/** The schema, applied through `schema_migrations` so a later change is one more entry. */
const migrations = [
  `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('workflow', 'direct')),
      input_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'provisioning', 'running', 'waiting_input', 'completed', 'failed', 'cancelled', 'interrupted')),
      workspace_policy TEXT NOT NULL CHECK(workspace_policy IN ('none', 'run')),
      workspace_strategy TEXT CHECK(workspace_strategy IN ('isolated_worktree', 'new_branch', 'current_branch')),
      workspace_access TEXT CHECK(workspace_access IN ('shared_read', 'exclusive_write')),
      workflow_snapshot_id TEXT,
      workspace_id TEXT,
      worktree_path TEXT,
      canonical_workspace_path TEXT,
      checkout_canonical_path TEXT,
      checkout_branch TEXT,
      environment_id TEXT,
      branch TEXT,
      base_branch TEXT,
      base_commit TEXT,
      profile TEXT,
      engine_kind TEXT,
      engine_run_id TEXT,
      error TEXT,
      result_json TEXT,
      operation_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(project_id, branch),
      UNIQUE(canonical_workspace_path)
    );

    CREATE TABLE IF NOT EXISTS workflow_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
      definition_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('builtin', 'global', 'project')),
      path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      key_version TEXT NOT NULL DEFAULT 'v1',
      source TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      node_key TEXT NOT NULL,
      label TEXT NOT NULL,
      phase TEXT,
      attempt INTEGER NOT NULL CHECK(attempt > 0),
      harness TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      effective_config_json TEXT NOT NULL,
      workspace_id TEXT,
      input_json TEXT,
      output_json TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
      usage_json TEXT,
      error TEXT,
      session_id TEXT,
      capabilities_json TEXT,
      checkpoint_json TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(run_id, node_key, attempt)
    );

    CREATE TABLE IF NOT EXISTS event_cursors (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      execution_id TEXT,
      session_id TEXT,
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('run', 'workflow', 'harness', 'session', 'system')),
      payload_json TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS workspace_leases (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      execution_id TEXT,
      parent_workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('run', 'fork')),
      status TEXT NOT NULL CHECK(status IN ('reserved', 'active', 'released', 'preserved')),
      workspace_id TEXT NOT NULL UNIQUE,
      worktree_path TEXT NOT NULL,
      canonical_workspace_path TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL UNIQUE,
      base_branch TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      released_at TEXT
    );

    CREATE TABLE IF NOT EXISTS checkout_claims (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      project_id TEXT NOT NULL,
      canonical_path TEXT NOT NULL,
      access TEXT NOT NULL CHECK(access IN ('shared_read', 'exclusive_write')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS checkout_claims_path_idx ON checkout_claims(project_id, canonical_path);
  `,
  `ALTER TABLE runs ADD COLUMN issue_ref TEXT;`,
]

function defaultRunStorePath(): string {
  return globalPaths().database
}

function encodeJson(value: JsonValue | null): string | null {
  return value === null ? null : JSON.stringify(value)
}

function decodeJson(value: string): JsonValue {
  return JsonValueSchema.parse(JSON.parse(value))
}

function decodeOptionalJson(value: string | null): JsonValue | null {
  return value === null ? null : decodeJson(value)
}

function parseRunMode(value: string): RunMode {
  if (value === 'workflow' || value === 'direct') return value
  throw new Error(`Invalid persisted Run mode: ${value}`)
}

function isRunStatus(value: string): value is RunStatus {
  return (
    value === 'queued' ||
    value === 'provisioning' ||
    value === 'running' ||
    value === 'waiting_input' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  )
}

function parseRunStatus(value: string): RunStatus {
  if (isRunStatus(value)) return value
  throw new Error(`Invalid persisted Run status: ${value}`)
}

function isExecutionStatus(value: string): value is ExecutionStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'cancelled'
  )
}

function parseExecutionStatus(value: string): ExecutionStatus {
  if (isExecutionStatus(value)) return value
  throw new Error(`Invalid persisted Execution status: ${value}`)
}

function parseWorkspacePolicy(value: string): WorkspacePolicy {
  if (value === 'none' || value === 'run') return value
  throw new Error(`Invalid persisted workspace policy: ${value}`)
}

function parseWorkspaceAccess(value: string | null): WorkspaceAccess {
  return value === 'shared_read' ? 'shared_read' : 'exclusive_write'
}

function parseLeaseKind(value: string): WorkspaceLeaseKind {
  if (value === 'run' || value === 'fork') return value
  throw new Error(`Invalid persisted workspace lease kind: ${value}`)
}

function parseLeaseStatus(value: string): WorkspaceLeaseStatus {
  if (value === 'reserved' || value === 'active' || value === 'released' || value === 'preserved') return value
  throw new Error(`Invalid persisted workspace lease status: ${value}`)
}

function toWorkspaceLeaseRecord(row: WorkspaceLeaseRow): WorkspaceLeaseRecord {
  return {
    id: row.id,
    runId: row.run_id,
    executionId: row.execution_id,
    parentWorkspaceId: row.parent_workspace_id,
    kind: parseLeaseKind(row.kind),
    status: parseLeaseStatus(row.status),
    workspaceId: row.workspace_id,
    worktreePath: row.worktree_path,
    canonicalWorkspacePath: row.canonical_workspace_path,
    branch: row.branch,
    baseBranch: row.base_branch,
    baseCommit: row.base_commit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    releasedAt: row.released_at,
  }
}

function sameChildLease(existing: WorkspaceLeaseRecord, input: ChildLeaseReservation): boolean {
  return (
    existing.runId === input.runId &&
    existing.parentWorkspaceId === input.parentWorkspaceId &&
    existing.workspaceId === input.workspaceId &&
    existing.worktreePath === input.worktreePath &&
    existing.canonicalWorkspacePath === input.canonicalWorkspacePath &&
    existing.branch === input.branch &&
    existing.baseBranch === input.baseBranch &&
    existing.baseCommit === input.baseCommit &&
    (input.executionId == null || existing.executionId === input.executionId)
  )
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: parseRunMode(row.mode),
    input: decodeJson(row.input_json),
    status: parseRunStatus(row.status),
    workspacePolicy: parseWorkspacePolicy(row.workspace_policy),
    workspaceStrategy:
      row.workspace_strategy === 'new_branch' || row.workspace_strategy === 'current_branch'
        ? row.workspace_strategy
        : 'isolated_worktree',
    workspaceAccess: parseWorkspaceAccess(row.workspace_access),
    workflowSnapshotId: row.workflow_snapshot_id,
    environmentId: row.environment_id,
    workspaceId: row.workspace_id,
    worktreePath: row.worktree_path,
    canonicalWorkspacePath: row.checkout_canonical_path ?? row.canonical_workspace_path,
    branch: row.checkout_branch ?? row.branch,
    baseBranch: row.base_branch,
    baseCommit: row.base_commit,
    profile: row.profile,
    engineKind: row.engine_kind,
    engineRunId: row.engine_run_id,
    error: row.error,
    result: decodeOptionalJson(row.result_json),
    operationId: row.operation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    issueRef: row.issue_ref,
  }
}

function toExecutionRecord(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    nodeKey: row.node_key,
    label: row.label,
    phase: row.phase,
    attempt: row.attempt,
    harness: row.harness,
    provider: row.provider,
    model: row.model,
    effectiveConfig: decodeJson(row.effective_config_json),
    workspaceId: row.workspace_id,
    input: decodeOptionalJson(row.input_json),
    output: decodeOptionalJson(row.output_json),
    status: parseExecutionStatus(row.status),
    usage: decodeOptionalJson(row.usage_json),
    error: row.error,
    sessionId: row.session_id,
    capabilities: decodeOptionalJson(row.capabilities_json),
    checkpoint: decodeOptionalJson(row.checkpoint_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

function toWorkflowSnapshotRecord(row: WorkflowSnapshotRow): WorkflowSnapshotRecord {
  return {
    id: row.id,
    runId: row.run_id,
    definitionId: row.definition_id,
    name: row.name,
    description: row.description,
    origin: row.origin,
    path: row.path,
    contentHash: row.content_hash,
    engineVersion: row.engine_version,
    keyVersion: row.key_version,
    source: row.source,
    metadata: decodeJson(row.metadata_json),
    createdAt: row.created_at,
  }
}

function toEventCursor(row: EventCursorRow): EventCursor {
  return { runId: row.run_id, sequence: row.sequence, source: row.source, updatedAt: row.updated_at }
}

function toRunEventRecord(row: RunEventRow): RunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    executionId: row.execution_id,
    sessionId: row.session_id,
    sequence: row.sequence,
    type: row.type,
    timestamp: row.timestamp,
    source: row.source,
    payload: decodeJson(row.payload_json),
  }
}

function isConstraint(error: unknown, target: string): boolean {
  return error instanceof Error && error.message.includes(target)
}

export function createRunStore(path: string = defaultRunStorePath()): RunStore {
  mkdirSync(dirname(path), { recursive: true })
  const database = openDatabase(path)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)')
  const applied = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations ORDER BY version')
    .all()
  const appliedVersions = new Set(applied.map((entry) => entry.version))
  const migrate = database.transaction((): void => {
    migrations.forEach((migration, index) => {
      const version = index + 1
      if (appliedVersions.has(version)) return
      database.exec(migration)
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
    })
  })
  migrate()

  const selectRun = database.prepare<[string], RunRow>('SELECT * FROM runs WHERE id = ?')
  const selectRunByOperation = database.prepare<[string], RunRow>('SELECT * FROM runs WHERE operation_id = ?')
  const selectRuns = database.prepare<[string], RunRow>(
    'SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC, id DESC',
  )
  const selectSnapshot = database.prepare<[string], WorkflowSnapshotRow>(
    'SELECT * FROM workflow_snapshots WHERE run_id = ?',
  )
  const selectExecutions = database.prepare<[string], ExecutionRow>(
    'SELECT * FROM executions WHERE run_id = ? ORDER BY node_key, attempt',
  )
  const selectExecution = database.prepare<[string], ExecutionRow>('SELECT * FROM executions WHERE id = ?')
  const selectCursor = database.prepare<[string], EventCursorRow>('SELECT * FROM event_cursors WHERE run_id = ?')
  const selectEvents = database.prepare<[string, number], RunEventRow>(
    'SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence',
  )
  const selectEvent = database.prepare<[string, number], RunEventRow>(
    'SELECT * FROM run_events WHERE run_id = ? AND sequence = ?',
  )
  const selectClaims = database.prepare<[string, string], CheckoutClaim>(
    'SELECT run_id AS runId, project_id AS projectId, canonical_path AS canonicalPath, access, created_at AS createdAt FROM checkout_claims WHERE project_id = ? AND canonical_path = ? ORDER BY created_at',
  )

  const insertRun = database.prepare(`
    INSERT INTO runs (
      id, project_id, mode, input_json, status, workspace_policy, workspace_strategy, workspace_access, checkout_canonical_path, checkout_branch, workflow_snapshot_id, environment_id, workspace_id,
      worktree_path, canonical_workspace_path, branch, base_branch, base_commit, profile, engine_kind,
      engine_run_id, error, result_json, operation_id, created_at, updated_at, started_at, completed_at, issue_ref
    ) VALUES (
      @id, @projectId, @mode, @inputJson, @status, @workspacePolicy, @workspaceStrategy, @workspaceAccess, @checkoutCanonicalPath, @checkoutBranch, @workflowSnapshotId, @environmentId, @workspaceId,
      @worktreePath, @canonicalWorkspacePath, @branch, @baseBranch, @baseCommit, @profile, @engineKind,
      @engineRunId, @error, @resultJson, @operationId, @createdAt, @updatedAt, @startedAt, @completedAt, @issueRef
    )
  `)
  const insertSnapshot = database.prepare(`
    INSERT INTO workflow_snapshots (
      id, run_id, definition_id, name, description, origin, path, content_hash, engine_version, key_version, source, metadata_json, created_at
    ) VALUES (
      @id, @runId, @definitionId, @name, @description, @origin, @path, @contentHash, @engineVersion, @keyVersion, @source, @metadataJson, @createdAt
    )
  `)
  const updateRun = database.prepare(`
    UPDATE runs
    SET status = @status, error = @error, result_json = @resultJson, engine_run_id = @engineRunId,
        updated_at = @updatedAt, started_at = @startedAt, completed_at = @completedAt
    WHERE id = @id
  `)
  const updateRunEnvironment = database.prepare('UPDATE runs SET environment_id = ?, updated_at = ? WHERE id = ?')
  const reserveWorkspace = database.prepare(`
    UPDATE runs
    SET workspace_id = @workspaceId, worktree_path = @worktreePath, canonical_workspace_path = @canonicalWorkspacePath,
        branch = @branch, base_branch = @baseBranch, base_commit = @baseCommit, workspace_strategy = @strategy,
        workspace_access = @access, checkout_canonical_path = @checkoutCanonicalPath, checkout_branch = @checkoutBranch,
        status = 'provisioning', updated_at = @updatedAt
    WHERE id = @runId
  `)
  const insertClaim = database.prepare(
    'INSERT INTO checkout_claims (run_id, project_id, canonical_path, access, created_at) VALUES (@runId, @projectId, @canonicalPath, @access, @createdAt)',
  )
  const deleteClaim = database.prepare('DELETE FROM checkout_claims WHERE run_id = ?')
  const upsertExecution = database.prepare(`
    INSERT INTO executions (
      id, run_id, node_key, label, phase, attempt, harness, provider, model, effective_config_json,
      workspace_id, input_json, output_json, status, usage_json, error, session_id, capabilities_json, checkpoint_json, started_at, completed_at
    ) VALUES (
      @id, @runId, @nodeKey, @label, @phase, @attempt, @harness, @provider, @model, @effectiveConfigJson,
      @workspaceId, @inputJson, @outputJson, @status, @usageJson, @error, @sessionId, @capabilitiesJson, @checkpointJson, @startedAt, @completedAt
    ) ON CONFLICT(run_id, node_key, attempt) DO UPDATE SET
      id = excluded.id, label = excluded.label, phase = excluded.phase, harness = excluded.harness,
      provider = excluded.provider, model = excluded.model, effective_config_json = excluded.effective_config_json,
      workspace_id = excluded.workspace_id, input_json = excluded.input_json, output_json = excluded.output_json,
      status = excluded.status, usage_json = excluded.usage_json, error = excluded.error, session_id = excluded.session_id,
      capabilities_json = excluded.capabilities_json, checkpoint_json = excluded.checkpoint_json, started_at = excluded.started_at, completed_at = excluded.completed_at
  `)
  const upsertCursor = database.prepare(`
    INSERT INTO event_cursors (run_id, sequence, source, updated_at)
    VALUES (@runId, @sequence, @source, @updatedAt)
    ON CONFLICT(run_id) DO UPDATE SET sequence = excluded.sequence, source = excluded.source, updated_at = excluded.updated_at
  `)
  const insertEvent = database.prepare(`
    INSERT INTO run_events (id, run_id, execution_id, session_id, sequence, type, timestamp, source, payload_json)
    VALUES (@id, @runId, @executionId, @sessionId, @sequence, @type, @timestamp, @source, @payloadJson)
  `)
  const selectLease = database.prepare<[string], WorkspaceLeaseRow>('SELECT * FROM workspace_leases WHERE id = ?')
  const selectLeases = database.prepare<[string], WorkspaceLeaseRow>(
    'SELECT * FROM workspace_leases WHERE run_id = ? ORDER BY created_at, id',
  )
  const selectRunByBranch = database.prepare<[string], RunRow>('SELECT * FROM runs WHERE branch = ?')
  const selectRunByPath = database.prepare<[string], RunRow>('SELECT * FROM runs WHERE canonical_workspace_path = ?')
  const insertLease = database.prepare(`
    INSERT INTO workspace_leases (
      id, run_id, execution_id, parent_workspace_id, kind, status, workspace_id, worktree_path,
      canonical_workspace_path, branch, base_branch, base_commit, created_at, updated_at, released_at
    ) VALUES (
      @id, @runId, @executionId, @parentWorkspaceId, 'fork', 'reserved', @workspaceId, @worktreePath,
      @canonicalWorkspacePath, @branch, @baseBranch, @baseCommit, @createdAt, @createdAt, NULL
    )
  `)
  const updateLease = database.prepare(`
    UPDATE workspace_leases SET status = @status, updated_at = @updatedAt, released_at = @releasedAt WHERE id = @id
  `)
  const removeLease = database.prepare('DELETE FROM workspace_leases WHERE id = ?')

  const create = database.transaction((input: CreateRunRecord, snapshot: WorkflowSnapshotRecord | undefined): void => {
    insertRun.run({
      ...input,
      workspaceStrategy: input.workspaceStrategy ?? 'isolated_worktree',
      workspaceAccess: input.workspaceAccess ?? 'exclusive_write',
      checkoutCanonicalPath: null,
      checkoutBranch: null,
      workflowSnapshotId: input.workflowSnapshotId ?? null,
      environmentId: input.environmentId ?? null,
      workspaceId: input.workspaceId ?? null,
      worktreePath: input.worktreePath ?? null,
      canonicalWorkspacePath: input.canonicalWorkspacePath ?? null,
      branch: input.branch ?? null,
      baseBranch: input.baseBranch ?? null,
      baseCommit: input.baseCommit ?? null,
      profile: input.profile ?? null,
      engineKind: input.engineKind ?? null,
      engineRunId: input.engineRunId ?? null,
      error: input.error ?? null,
      resultJson: encodeJson(input.result ?? null),
      inputJson: JSON.stringify(input.input),
      updatedAt: input.createdAt,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      issueRef: input.issueRef ?? null,
    })
    if (snapshot) {
      if (snapshot.runId !== input.id || snapshot.id !== input.workflowSnapshotId) {
        throw new Error('Workflow snapshot must belong to the Run being created')
      }
      insertSnapshot.run({
        ...snapshot,
        contentHash: snapshot.contentHash,
        engineVersion: snapshot.engineVersion,
        keyVersion: snapshot.keyVersion,
        metadataJson: JSON.stringify(snapshot.metadata),
      })
    }
  })

  const project = database.transaction((input: ProjectionUpdate): void => {
    const currentCursor = selectCursor.get(input.cursor.runId)
    if (currentCursor && input.cursor.sequence < currentCursor.sequence) {
      throw new Error('Event cursor cannot move backwards')
    }
    upsertExecution.run({
      ...input.execution,
      effectiveConfigJson: JSON.stringify(input.execution.effectiveConfig),
      inputJson: encodeJson(input.execution.input),
      outputJson: encodeJson(input.execution.output),
      usageJson: encodeJson(input.execution.usage),
      capabilitiesJson: encodeJson(input.execution.capabilities),
      checkpointJson: encodeJson(input.execution.checkpoint),
    })
    upsertCursor.run(input.cursor)
  })
  const append = database.transaction((input: EventAppend): 'appended' | 'replayed' => {
    const existing = selectEvent.get(input.event.runId, input.event.sequence)
    if (existing) return 'replayed'
    const currentCursor = selectCursor.get(input.cursor.runId)
    if (currentCursor && input.cursor.sequence < currentCursor.sequence) {
      throw new Error('Event cursor cannot move backwards')
    }
    if (input.execution) {
      upsertExecution.run({
        ...input.execution,
        effectiveConfigJson: JSON.stringify(input.execution.effectiveConfig),
        inputJson: encodeJson(input.execution.input),
        outputJson: encodeJson(input.execution.output),
        usageJson: encodeJson(input.execution.usage),
        capabilitiesJson: encodeJson(input.execution.capabilities),
        checkpointJson: encodeJson(input.execution.checkpoint),
      })
    }
    insertEvent.run({
      ...input.event,
      executionId: input.event.executionId,
      sessionId: input.event.sessionId,
      payloadJson: JSON.stringify(input.event.payload),
    })
    upsertCursor.run(input.cursor)
    return 'appended'
  })

  return {
    createRun(input: CreateRunRecord, snapshot?: WorkflowSnapshotRecord): CreateRunResult | CreateRunConflict {
      const prior = selectRunByOperation.get(input.operationId)
      if (prior) return { ok: true, run: toRunRecord(prior), replayed: true }
      try {
        create(input, snapshot)
      } catch (error: unknown) {
        if (isConstraint(error, 'runs.project_id, runs.branch')) return { ok: false, reason: 'branch_conflict' }
        if (isConstraint(error, 'runs.canonical_workspace_path'))
          return { ok: false, reason: 'workspace_path_conflict' }
        throw error
      }
      const run = selectRun.get(input.id)
      if (!run) throw new Error(`Run ${input.id} was not persisted`)
      return { ok: true, run: toRunRecord(run), replayed: false }
    },

    getRun(runId: string): RunRecord | null {
      const row = selectRun.get(runId)
      return row ? toRunRecord(row) : null
    },

    listRuns(projectId: string): RunRecord[] {
      return selectRuns.all(projectId).map(toRunRecord)
    },

    setEnvironment(runId: string, environmentId: string, updatedAt: string): RunRecord | null {
      updateRunEnvironment.run(environmentId, updatedAt, runId)
      const row = selectRun.get(runId)
      return row ? toRunRecord(row) : null
    },

    getWorkflowSnapshot(runId: string): WorkflowSnapshotRecord | null {
      const row = selectSnapshot.get(runId)
      return row ? toWorkflowSnapshotRecord(row) : null
    },

    getExecutions(runId: string): ExecutionRecord[] {
      return selectExecutions.all(runId).map(toExecutionRecord)
    },

    getExecution(executionId: string): ExecutionRecord | null {
      const row = selectExecution.get(executionId)
      return row ? toExecutionRecord(row) : null
    },

    getEventCursor(runId: string): EventCursor | null {
      const row = selectCursor.get(runId)
      return row ? toEventCursor(row) : null
    },

    listEvents(runId: string, after: number = -1): RunEventRecord[] {
      return selectEvents.all(runId, after).map(toRunEventRecord)
    },

    reserveChildLease(input): ChildLeaseReservationSuccess | ChildLeaseReservationFailure {
      const current = selectRun.get(input.runId)
      if (!current) return { ok: false, reason: 'not_found' }
      const run = toRunRecord(current)
      if (run.workspaceId === null || run.workspaceId !== input.parentWorkspaceId || run.baseCommit === null) {
        return { ok: false, reason: 'parent_workspace_missing' }
      }
      const existing = selectLease.get(input.id)
      if (existing) {
        const lease = toWorkspaceLeaseRecord(existing)
        return sameChildLease(lease, input)
          ? { ok: true, lease, replayed: true }
          : { ok: false, reason: 'lease_conflict' }
      }
      if (selectRunByBranch.get(input.branch) || selectRunByPath.get(input.canonicalWorkspacePath)) {
        return {
          ok: false,
          reason: selectRunByBranch.get(input.branch) ? 'branch_conflict' : 'workspace_path_conflict',
        }
      }
      try {
        insertLease.run({
          ...input,
          executionId: input.executionId ?? null,
        })
      } catch (error: unknown) {
        if (isConstraint(error, 'workspace_leases.branch')) return { ok: false, reason: 'branch_conflict' }
        if (
          isConstraint(error, 'workspace_leases.canonical_workspace_path') ||
          isConstraint(error, 'workspace_leases.workspace_id')
        ) {
          return { ok: false, reason: 'workspace_path_conflict' }
        }
        throw error
      }
      const reserved = selectLease.get(input.id)
      if (!reserved) throw new Error(`Lease ${input.id} was not persisted`)
      return { ok: true, lease: toWorkspaceLeaseRecord(reserved), replayed: false }
    },

    getLease(leaseId): WorkspaceLeaseRecord | null {
      const row = selectLease.get(leaseId)
      return row ? toWorkspaceLeaseRecord(row) : null
    },

    listLeases(runId): WorkspaceLeaseRecord[] {
      return selectLeases.all(runId).map(toWorkspaceLeaseRecord)
    },

    updateLeaseStatus(leaseId, status, updatedAt, releasedAt = null): WorkspaceLeaseRecord | null {
      const current = selectLease.get(leaseId)
      if (!current) return null
      updateLease.run({ id: leaseId, status, updatedAt, releasedAt })
      const updated = selectLease.get(leaseId)
      return updated ? toWorkspaceLeaseRecord(updated) : null
    },

    deleteLease(leaseId): void {
      removeLease.run(leaseId)
    },

    acquireCheckoutClaim(input): { ok: true } | { ok: false; reason: 'checkout_busy'; conflictingRunIds: string[] } {
      const acquire = database.transaction(
        (): { ok: true } | { ok: false; reason: 'checkout_busy'; conflictingRunIds: string[] } => {
          const existing = selectClaims.all(input.projectId, input.canonicalPath)
          const conflicts = existing.filter(
            (claim) =>
              claim.runId !== input.runId && (input.access === 'exclusive_write' || claim.access === 'exclusive_write'),
          )
          if (conflicts.length > 0)
            return { ok: false, reason: 'checkout_busy', conflictingRunIds: conflicts.map((claim) => claim.runId) }
          if (!existing.some((claim) => claim.runId === input.runId)) insertClaim.run(input)
          return { ok: true }
        },
      )
      return acquire()
    },

    releaseCheckoutClaim(runId): void {
      deleteClaim.run(runId)
    },

    listCheckoutClaims(projectId, canonicalPath): CheckoutClaim[] {
      return selectClaims.all(projectId, canonicalPath)
    },

    reserveWorkspace(input): WorkspaceReservationSuccess | WorkspaceReservationFailure {
      const strategy = input.strategy ?? 'isolated_worktree'
      const access = input.access ?? 'exclusive_write'
      const current = selectRun.get(input.runId)
      if (!current) return { ok: false, reason: 'not_found' }
      const run = toRunRecord(current)
      if (run.workspacePolicy !== 'run' || !['queued', 'provisioning'].includes(run.status)) {
        return { ok: false, reason: 'invalid_run_state' }
      }
      if (run.workspaceId !== null) {
        const matches =
          run.workspaceId === input.workspaceId &&
          run.worktreePath === input.worktreePath &&
          run.canonicalWorkspacePath === input.canonicalWorkspacePath &&
          run.branch === input.branch &&
          run.baseBranch === input.baseBranch &&
          run.baseCommit === input.baseCommit
        return matches ? { ok: true, run, replayed: true } : { ok: false, reason: 'workspace_already_reserved' }
      }
      try {
        reserveWorkspace.run({
          ...input,
          strategy,
          access,
          canonicalWorkspacePath: strategy === 'isolated_worktree' ? input.canonicalWorkspacePath : null,
          branch: strategy === 'isolated_worktree' ? input.branch : null,
          checkoutCanonicalPath: strategy === 'isolated_worktree' ? null : input.canonicalWorkspacePath,
          checkoutBranch: strategy === 'isolated_worktree' ? null : input.branch,
        })
      } catch (error: unknown) {
        if (isConstraint(error, 'runs.project_id, runs.branch')) return { ok: false, reason: 'branch_conflict' }
        if (isConstraint(error, 'runs.canonical_workspace_path'))
          return { ok: false, reason: 'workspace_path_conflict' }
        throw error
      }
      const reserved = selectRun.get(input.runId)
      if (!reserved) throw new Error(`Run ${input.runId} disappeared during workspace reservation`)
      return { ok: true, run: toRunRecord(reserved), replayed: false }
    },

    transitionRun(runId, nextStatus, updatedAt, updates = {}): RunTransitionSuccess | RunTransitionFailure {
      const current = selectRun.get(runId)
      if (!current) return { ok: false, reason: 'not_found' }
      const run = toRunRecord(current)
      if (!isRunTransitionAllowed(run.status, nextStatus)) return { ok: false, reason: 'invalid_transition' }
      updateRun.run({
        id: runId,
        status: nextStatus,
        error: updates.error ?? run.error,
        resultJson: encodeJson(updates.result ?? run.result),
        engineRunId: updates.engineRunId ?? run.engineRunId,
        updatedAt,
        startedAt: updates.startedAt ?? run.startedAt,
        completedAt: updates.completedAt ?? run.completedAt,
      })
      const updated = selectRun.get(runId)
      if (!updated) throw new Error(`Run ${runId} disappeared during transition`)
      return { ok: true, run: toRunRecord(updated) }
    },

    applyExecutionProjection(input): ProjectionUpdateSuccess | ProjectionUpdateFailure {
      if (input.execution.runId !== input.cursor.runId) return { ok: false, reason: 'run_mismatch' }
      try {
        project(input)
        return { ok: true }
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'Event cursor cannot move backwards') {
          return { ok: false, reason: 'cursor_regression' }
        }
        throw error
      }
    },

    appendEvent(input): EventAppendSuccess | EventAppendFailure {
      if (
        input.event.runId !== input.cursor.runId ||
        (input.execution && input.execution.runId !== input.event.runId)
      ) {
        return { ok: false, reason: 'run_mismatch' }
      }
      try {
        return { ok: true, replayed: append(input) === 'replayed' }
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'Event cursor cannot move backwards') {
          return { ok: false, reason: 'cursor_regression' }
        }
        throw error
      }
    },

    close(): void {
      database.close()
    },
  }
}

export function getSharedRunStore(): RunStore {
  if (sharedRunStore === null) sharedRunStore = createRunStore()
  return sharedRunStore
}
