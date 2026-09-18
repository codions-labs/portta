import type {
  AgentDetails,
  AgentResponse,
  DiagnosticsResponse,
  UpsertCustomAgentRequest,
  ValidateCustomAgentResponse,
} from '../types.ts'
import type { TaskflowClient } from './client.ts'

export function agentApi({ contract }: TaskflowClient) {
  return {
    fetchAgents: (): Promise<AgentDetails[]> => contract.fetchAgents().then((response) => response.agents),
    createAgent: (body: UpsertCustomAgentRequest): Promise<AgentResponse> => contract.createAgent({ body }),
    updateAgent: (id: string, body: UpsertCustomAgentRequest): Promise<AgentResponse> =>
      contract.updateAgent({ params: { id }, body }),
    deleteAgent: (id: string): Promise<void> => contract.deleteAgent({ params: { id } }).then(() => undefined),
    validateAgent: (body: UpsertCustomAgentRequest): Promise<ValidateCustomAgentResponse> =>
      contract.validateAgent({ body }),
    fetchDiagnostics: (): Promise<DiagnosticsResponse> => contract.fetchDiagnostics(),
  }
}
