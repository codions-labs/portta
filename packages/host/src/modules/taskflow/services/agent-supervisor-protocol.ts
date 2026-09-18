import type { AgentLaunchSpec, SupervisedOperation, SupervisedOperationEvent } from './agent-runtime-types.ts'

export const AGENT_SUPERVISOR_PROTOCOL_VERSION = 1

export type AgentSupervisorRequest =
  | { id: string; version: 1; method: 'start'; params: AgentLaunchSpec }
  | { id: string; version: 1; method: 'inspect'; params: { operationId: string } }
  | { id: string; version: 1; method: 'events'; params: { operationId: string; after: number } }
  | { id: string; version: 1; method: 'cancel'; params: { operationId: string } }
  | {
      id: string
      version: 1
      method: 'respondPermission'
      params: { operationId: string; requestId: string; optionId: string | null }
    }
  | { id: string; version: 1; method: 'status'; params: Record<string, never> }
  | { id: string; version: 1; method: 'list'; params: { prefix?: string } }

export type AgentSupervisorResponse =
  | {
      id: string
      version: 1
      result:
        | { operation: SupervisedOperation; replayed: boolean }
        | SupervisedOperation
        | SupervisedOperation[]
        | SupervisedOperationEvent[]
        | { active: boolean }
    }
  | { id: string; version: 1; error: string }
