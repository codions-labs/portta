import type { JsonValue, SessionCapability } from 'portta-contracts/taskflow'
import type { RunRecord } from 'portta-core/taskflow'
import type {
  AgentPermissionMode,
  AgentTransport,
  StdioMcpServer,
  SupervisedOperationEvent,
} from './agent-runtime-types.ts'
import type { WorkspaceBinding } from './workspace-facade.ts'

export interface DirectSessionStartInput {
  run: RunRecord
  workspace: WorkspaceBinding
  harness: string
  provider: string | null
  model: string | null
  transport: AgentTransport
  permissionMode: AgentPermissionMode
  mcpServers: StdioMcpServer[]
}

export interface DirectSessionResumeInput extends DirectSessionStartInput {
  sessionId: string
}

export interface DirectSessionState {
  sessionId: string
  checkpoint: Record<string, string> | null
  capabilities: SessionCapability
  active: boolean
  activity: 'running' | 'waiting_input'
  terminal?: {
    status: 'completed' | 'failed' | 'cancelled' | 'recovery_required'
    result: JsonValue | null
    error: string | null
  }
}

export interface DirectSessionPort {
  start(input: DirectSessionStartInput): Promise<DirectSessionState>
  cancel(sessionId: string): Promise<void>
  resume(input: DirectSessionResumeInput): Promise<DirectSessionState>
  inspect(sessionId: string): Promise<DirectSessionState | null>
  events?(sessionId: string, after?: number): Promise<SupervisedOperationEvent[]>
  respondPermission?(sessionId: string, requestId: string, optionId: string | null): Promise<void>
}
