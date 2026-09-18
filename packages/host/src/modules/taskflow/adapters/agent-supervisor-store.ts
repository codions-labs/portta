import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AgentLaunchSpec,
  SupervisedOperation,
  SupervisedOperationEvent,
  SupervisedOperationStatus,
} from '../services/agent-runtime-types.ts'
import { openDatabase } from './sqlite.ts'

interface OperationRow {
  id: string
  status: SupervisedOperationStatus
  transport: 'native' | 'acp'
  provider: string
  session_id: string | null
  native_session_id: string | null
  capabilities_json: string | null
  pid: number | null
  result_json: string | null
  error: string | null
  exit_code: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface EventRow {
  id: string
  operation_id: string
  sequence: number
  type: string
  timestamp: string
  payload_json: string
}

export type OperationPatch = Partial<
  Pick<
    SupervisedOperation,
    | 'status'
    | 'sessionId'
    | 'nativeSessionId'
    | 'capabilities'
    | 'pid'
    | 'result'
    | 'error'
    | 'exitCode'
    | 'completedAt'
  >
>

export interface AgentSupervisorStore {
  create(spec: AgentLaunchSpec): { operation: SupervisedOperation; replayed: boolean }
  get(operationId: string): SupervisedOperation | null
  update(operationId: string, patch: OperationPatch): SupervisedOperation
  appendEvent(operationId: string, type: string, payload: SupervisedOperationEvent['payload']): SupervisedOperationEvent
  listEvents(operationId: string, after: number): SupervisedOperationEvent[]
  listActive(): SupervisedOperation[]
  list(prefix?: string): SupervisedOperation[]
  close(): void
}

function parseJson(value: string | null): SupervisedOperation['result'] {
  return value === null ? null : (JSON.parse(value) as SupervisedOperation['result'])
}

function operationFromRow(row: OperationRow): SupervisedOperation {
  return {
    id: row.id,
    status: row.status,
    transport: row.transport,
    provider: row.provider,
    sessionId: row.session_id,
    nativeSessionId: row.native_session_id,
    capabilities:
      row.capabilities_json === null
        ? null
        : (JSON.parse(row.capabilities_json) as SupervisedOperation['capabilities']),
    pid: row.pid,
    result: parseJson(row.result_json),
    error: row.error,
    exitCode: row.exit_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function eventFromRow(row: EventRow): SupervisedOperationEvent {
  return {
    id: row.id,
    operationId: row.operation_id,
    sequence: row.sequence,
    type: row.type,
    timestamp: row.timestamp,
    payload: JSON.parse(row.payload_json) as SupervisedOperationEvent['payload'],
  }
}

export function createAgentSupervisorStore(path: string): AgentSupervisorStore {
  mkdirSync(dirname(path), { recursive: true })
  const database = openDatabase(path)
  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS supervisor_operations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      transport TEXT NOT NULL,
      provider TEXT NOT NULL,
      launch_spec_json TEXT NOT NULL,
      session_id TEXT,
      native_session_id TEXT,
      capabilities_json TEXT,
      pid INTEGER,
      result_json TEXT,
      error TEXT,
      exit_code INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS supervisor_events (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES supervisor_operations(id),
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(operation_id, sequence)
    );
  `)
  const select = database.prepare<[string], OperationRow>('SELECT * FROM supervisor_operations WHERE id = ?')
  const insert = database.prepare(`
    INSERT INTO supervisor_operations (
      id, status, transport, provider, launch_spec_json, created_at, updated_at
    ) VALUES (@id, @status, @transport, @provider, @launchSpec, @createdAt, @updatedAt)
  `)
  const update = database.prepare(`
    UPDATE supervisor_operations SET
      status = @status, session_id = @sessionId, native_session_id = @nativeSessionId,
      capabilities_json = @capabilities, pid = @pid, result_json = @result,
      error = @error, exit_code = @exitCode, updated_at = @updatedAt, completed_at = @completedAt
    WHERE id = @id
  `)
  const maxSequence = database.prepare<[string], { sequence: number | null }>(
    'SELECT MAX(sequence) AS sequence FROM supervisor_events WHERE operation_id = ?',
  )
  const insertEvent = database.prepare(`
    INSERT INTO supervisor_events (id, operation_id, sequence, type, timestamp, payload_json)
    VALUES (@id, @operationId, @sequence, @type, @timestamp, @payload)
  `)
  const listEvents = database.prepare<[string, number], EventRow>(
    'SELECT * FROM supervisor_events WHERE operation_id = ? AND sequence > ? ORDER BY sequence',
  )
  const listActive = database.prepare<[], OperationRow>(
    "SELECT * FROM supervisor_operations WHERE status IN ('starting', 'running', 'waiting_input') ORDER BY created_at",
  )
  const listAll = database.prepare<[], OperationRow>('SELECT * FROM supervisor_operations ORDER BY created_at')
  const listByPrefix = database.prepare<[string, string], OperationRow>(
    'SELECT * FROM supervisor_operations WHERE substr(id, 1, length(?)) = ? ORDER BY created_at',
  )

  const get = (operationId: string): SupervisedOperation | null => {
    const row = select.get(operationId)
    return row ? operationFromRow(row) : null
  }

  return {
    create(spec: AgentLaunchSpec): { operation: SupervisedOperation; replayed: boolean } {
      const existing = get(spec.operationId)
      if (existing) return { operation: existing, replayed: true }
      const now = new Date().toISOString()
      insert.run({
        id: spec.operationId,
        status: 'starting',
        transport: spec.transport,
        provider: spec.provider,
        launchSpec: JSON.stringify(spec),
        createdAt: now,
        updatedAt: now,
      })
      const operation = get(spec.operationId)
      if (!operation) throw new Error(`Unable to persist supervisor operation: ${spec.operationId}`)
      return { operation, replayed: false }
    },
    get,
    update(operationId: string, patch: OperationPatch): SupervisedOperation {
      const current = get(operationId)
      if (!current) throw new Error(`Supervisor operation was not found: ${operationId}`)
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
      update.run({
        id: operationId,
        status: next.status,
        sessionId: next.sessionId,
        nativeSessionId: next.nativeSessionId,
        capabilities: next.capabilities === null ? null : JSON.stringify(next.capabilities),
        pid: next.pid,
        result: next.result === null ? null : JSON.stringify(next.result),
        error: next.error,
        exitCode: next.exitCode,
        updatedAt: next.updatedAt,
        completedAt: next.completedAt,
      })
      const saved = get(operationId)
      if (!saved) throw new Error(`Unable to update supervisor operation: ${operationId}`)
      return saved
    },
    appendEvent(operationId, type, payload): SupervisedOperationEvent {
      if (!get(operationId)) throw new Error(`Supervisor operation was not found: ${operationId}`)
      const sequence = (maxSequence.get(operationId)?.sequence ?? 0) + 1
      const timestamp = new Date().toISOString()
      const event = { id: `${operationId}:${sequence}`, operationId, sequence, type, timestamp, payload }
      insertEvent.run({ ...event, payload: JSON.stringify(payload) })
      return event
    },
    listEvents(operationId, after): SupervisedOperationEvent[] {
      return listEvents.all(operationId, after).map(eventFromRow)
    },
    listActive(): SupervisedOperation[] {
      return listActive.all().map(operationFromRow)
    },
    list(prefix?: string): SupervisedOperation[] {
      return (prefix ? listByPrefix.all(prefix, prefix) : listAll.all()).map(operationFromRow)
    },
    close(): void {
      database.close()
    },
  }
}
