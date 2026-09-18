import type { ExternalRunContext } from '../runtime/journal.ts'

export const PORTTA_FLOW_WORKER_PROTOCOL_VERSION = 1

export interface TaskflowWorkerSpec {
  cwd: string
  source: string
  args: unknown
  dataRoot: string
  externalContext: ExternalRunContext
  fake?: boolean
  resume?: boolean
  projectRoot?: string
  workspaceRoot?: string
  profile?: string
  agent?: string
  runtime?: string
  environmentId?: string
  agentRuntime?: unknown
}

export type TaskflowWorkerMessage =
  | { type: 'started'; version: 1; runId: string; engineRunId: string; pid: number }
  | { type: 'event'; version: 1; runId: string; engineRunId: string; cursor: number; event: unknown }
  | { type: 'heartbeat'; version: 1; runId: string; engineRunId: string; cursor: number }
  | { type: 'cancel-ack'; version: 1; runId: string; engineRunId: string }
  | { type: 'completed'; version: 1; runId: string; engineRunId: string; cursor: number; result: unknown }
  | { type: 'failed'; version: 1; runId: string; engineRunId: string; cursor: number; error: string }
  | { type: 'crash'; version: 1; runId: string; engineRunId: string; cursor: number; error: string }
