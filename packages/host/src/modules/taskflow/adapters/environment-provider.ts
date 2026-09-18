import type {
  EnvironmentCommand,
  EnvironmentCommandHandle,
  EnvironmentHandle,
  EnvironmentProviderId,
  EnvironmentScope,
  EnvironmentSecurityAssessment,
  EnvironmentServiceAction,
  EnvironmentStatus,
  ResolvedEnvironment,
} from 'portta-core/taskflow'

export interface EnvironmentContext {
  workspacePath: string
  projectPath: string
  scope: EnvironmentScope
  configRef?: string
}

export interface EnvironmentProbe {
  provider: EnvironmentProviderId
  available: boolean
  configRefs: string[]
  version?: string
  diagnostics: string[]
}

export interface ObservedEnvironment {
  status: EnvironmentStatus
  containerIds: string[]
  diagnostics: string[]
}

export interface EnvironmentProvider {
  readonly id: EnvironmentProviderId
  probe(context: EnvironmentContext): Promise<EnvironmentProbe>
  resolve(context: EnvironmentContext): Promise<ResolvedEnvironment>
  start(environment: ResolvedEnvironment, scope: EnvironmentScope): Promise<EnvironmentHandle>
  inspect(handle: EnvironmentHandle): Promise<ObservedEnvironment>
  stop(handle: EnvironmentHandle): Promise<void>
  resume(handle: EnvironmentHandle): Promise<EnvironmentHandle>
  rebuild(
    environment: ResolvedEnvironment,
    scope: EnvironmentScope,
    previous?: EnvironmentHandle,
  ): Promise<EnvironmentHandle>
  destroy(handle: EnvironmentHandle): Promise<void>
  controlService?(
    handle: EnvironmentHandle,
    service: { name: string; containerIds: string[] },
    action: EnvironmentServiceAction,
  ): Promise<void>
}

export interface ExecutionTransport {
  readonly provider: EnvironmentProviderId
  spawn(handle: EnvironmentHandle, command: EnvironmentCommand): EnvironmentCommandHandle
  terminalCommand(handle: EnvironmentHandle, command: string): string
  executableShim(handle: EnvironmentHandle, executable: string): string
  terminalInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string }
  logsInvocation(handle: EnvironmentHandle): { command: string; args: string[]; cwd: string }
}

export interface EnvironmentTrustStore {
  isTrusted(projectId: string, configRef: string, configHash: string): boolean
  trust(projectId: string, configRef: string, configHash: string): void
}

export function requiresTrust(assessment: EnvironmentSecurityAssessment): boolean {
  return assessment.reasons.length > 0
}
