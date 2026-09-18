import type {
  EnvironmentExecRequest,
  EnvironmentExecResponse,
  EnvironmentResponse,
  EnvironmentServiceActionRequest,
  EnvironmentServicesResponse,
  OkResponse,
} from '../types.ts'
import type { TaskflowClient } from './client.ts'

export function environmentApi({ contract }: TaskflowClient) {
  return {
    fetchEnvironment: (environmentId: string): Promise<EnvironmentResponse> =>
      contract.fetchEnvironment({ params: { environmentId } }),
    fetchEnvironmentServices: (environmentId: string): Promise<EnvironmentServicesResponse> =>
      contract.fetchEnvironmentServices({ params: { environmentId } }),
    runEnvironmentCommand: (environmentId: string, request: EnvironmentExecRequest): Promise<EnvironmentExecResponse> =>
      contract.execEnvironment({ params: { environmentId }, body: request }),
    startEnvironment: (environmentId: string): Promise<EnvironmentResponse> =>
      contract.startEnvironment({ params: { environmentId } }),
    stopEnvironment: (environmentId: string): Promise<EnvironmentResponse> =>
      contract.stopEnvironment({ params: { environmentId } }),
    rebuildEnvironment: (environmentId: string): Promise<EnvironmentResponse> =>
      contract.rebuildEnvironment({ params: { environmentId } }),
    restartEnvironment: (environmentId: string): Promise<EnvironmentResponse> =>
      contract.restartEnvironment({ params: { environmentId } }),
    trustEnvironment: (environmentId: string): Promise<EnvironmentResponse> =>
      contract.trustEnvironment({ params: { environmentId } }),
    removeEnvironment: (environmentId: string): Promise<OkResponse> =>
      contract.removeEnvironment({ params: { environmentId } }),
    fetchEnvironmentTerminal: (environmentId: string) =>
      contract.openEnvironmentTerminal({ params: { environmentId } }),
    fetchEnvironmentLogs: (environmentId: string) => contract.fetchEnvironmentLogs({ params: { environmentId } }),
    exposeEnvironmentService: (environmentId: string, serviceId: string): Promise<EnvironmentServicesResponse> =>
      contract.exposeEnvironmentService({ params: { environmentId, serviceId }, body: { visibility: 'private' } }),
    controlEnvironmentService: (
      environmentId: string,
      serviceId: string,
      request: EnvironmentServiceActionRequest,
    ): Promise<EnvironmentServicesResponse> =>
      contract.controlEnvironmentService({ params: { environmentId, serviceId }, body: request }),
    removeEnvironmentEndpoint: (endpointId: string): Promise<OkResponse> =>
      contract.removeEndpoint({ params: { endpointId } }),
  }
}
