import type { AgentPermissionMode, AgentTransport, JsonValue, StdioMcpServer } from 'portta-contracts/taskflow'
import type { EnvironmentProviderId } from 'portta-core/taskflow'

export type { AgentPermissionMode, AgentTransport, StdioMcpServer }

export type SupervisedOperationStatus =
  | 'starting'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recovery_required'

export interface AgentLaunchSpec {
  operationId: string
  transport: AgentTransport
  provider: string
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  prompt: string
  sessionId?: string
  permissionMode: AgentPermissionMode
  mcpServers: StdioMcpServer[]
  execution: SupervisorExecution
}

export interface SupervisorExecution {
  provider: EnvironmentProviderId
  hostPath: string
  containerPath: string | null
  containerRef: string | null
}

export interface NegotiatedAgentCapabilities {
  loadSession: boolean
  resumeSession: boolean
  listSessions: boolean
  closeSession: boolean
  forkSession: boolean
  terminal: boolean
  mcp: { stdio: boolean; http: boolean; sse: boolean }
  raw: JsonValue
}

export interface SupervisedOperation {
  id: string
  status: SupervisedOperationStatus
  transport: AgentTransport
  provider: string
  sessionId: string | null
  nativeSessionId: string | null
  capabilities: NegotiatedAgentCapabilities | null
  pid: number | null
  result: JsonValue | null
  error: string | null
  exitCode: number | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface SupervisedOperationEvent {
  id: string
  operationId: string
  sequence: number
  type: string
  timestamp: string
  payload: JsonValue
}
