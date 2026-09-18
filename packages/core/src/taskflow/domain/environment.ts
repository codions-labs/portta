export type EnvironmentProviderId = 'host' | 'docker' | 'compose' | 'devcontainer' | 'dockerfile'
export type EnvironmentStatus =
  | 'detected'
  | 'resolving'
  | 'building'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'missing'
  | 'awaiting_trust'

export interface EnvironmentScope {
  installationId: string
  projectId: string
  workspaceId: string
  runId?: string
  executionId?: string
  userId?: string
}

export interface EnvironmentCapabilities {
  exec: boolean
  stdin: boolean
  pty: boolean
  resize: boolean
  signals: boolean
  reattach: boolean
  services: boolean
  rebuild: boolean
}

export interface EnvironmentSecurityAssessment {
  trusted: boolean
  reasons: string[]
  initializeCommand: boolean
  privileged: boolean
  dockerSocket: boolean
  devices: boolean
  broadMounts: boolean
  features: string[]
  unpinnedFeatures: string[]
  addedCapabilities: string[]
  securityOptions: string[]
  secretKeys: string[]
  isolationRisks: string[]
}

export interface EnvironmentWorkspace {
  hostPath: string
  containerPath?: string
}

export interface EnvironmentRuntimeOverride {
  path: string
  hash: string
  diff: string[]
  effective: { containerIds: string[]; cpus: number; memory: string; memorySwap: string; pids: number }
  validated: boolean
  diagnostics: string[]
}

export interface ResolvedEnvironment {
  provider: EnvironmentProviderId
  configRef: string | null
  configHash: string
  workspace: EnvironmentWorkspace
  capabilities: EnvironmentCapabilities
  security: EnvironmentSecurityAssessment
}

export interface EnvironmentHandle {
  id: string
  provider: EnvironmentProviderId
  scope: EnvironmentScope
  status: EnvironmentStatus
  workspace: EnvironmentWorkspace
  providerRef: { schemaVersion: number; value: Record<string, unknown> }
  runtimeOverride?: EnvironmentRuntimeOverride
}

export interface EnvironmentRecord extends EnvironmentHandle {
  desiredStatus: 'ready' | 'stopped' | 'destroyed'
  configRef: string | null
  configHash: string
  capabilities: EnvironmentCapabilities
  security: EnvironmentSecurityAssessment
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface EnvironmentTrustApproval {
  projectId: string
  provider: EnvironmentProviderId
  configRef: string
  configHash: string
  approvedAt: string
}

export interface EnvironmentCommand {
  argv: [string, ...string[]]
  cwd?: 'workspace' | { containerPath: string }
  env?: Record<string, string>
  stdin?: 'pipe' | 'inherit'
  pty?: { cols: number; rows: number }
  signal?: AbortSignal
  timeoutMs?: number
}

export interface EnvironmentCommandExit {
  code: number | null
  signal: string | null
  timedOut: boolean
}

export interface EnvironmentCommandHandle {
  readonly pid?: number
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<EnvironmentCommandExit>
  write(input: string | Uint8Array): Promise<void>
  closeStdin(): void
  interrupt(): Promise<void>
  kill(): Promise<void>
  resize?(cols: number, rows: number): Promise<void>
}

export type ServiceStatus = 'unknown' | 'starting' | 'running' | 'stopped' | 'unhealthy'
export type ServiceKind = 'http' | 'tcp' | 'database' | 'cache' | 'queue' | 'worker' | 'unknown'
export type EnvironmentServiceAction = 'start' | 'stop' | 'restart'
export type EndpointAudience = 'agent' | 'taskflow' | 'user'
export type EndpointVisibility = 'environment' | 'private' | 'authenticated' | 'public'
export type AccessMode = 'internal' | 'localhost' | 'lan' | 'vpn' | 'host' | 'public'
export type ExecutionLocus = 'environment' | 'host' | 'remote'

export interface DiscoveryEvidence {
  source: 'taskflow' | 'devcontainer' | 'compose' | 'docker' | 'probe' | 'runtime'
  detail: string
  confidence: 'explicit' | 'observed' | 'inferred'
}

export interface ServicePort {
  containerPort: number
  protocol: 'http' | 'https' | 'tcp' | 'udp' | 'unknown'
  hostBinding?: { host: string; port: number }
  label?: string
}

export interface Endpoint {
  id: string
  serviceId: string
  url: string
  audiences: EndpointAudience[]
  visibility: EndpointVisibility
  accessMode: AccessMode
  executionLocus: ExecutionLocus
  stable: boolean
  provider?: string
  providerResourceId?: string
}

export interface EnvironmentService {
  id: string
  environmentId: string
  name: string
  status: ServiceStatus
  kind: ServiceKind
  containerIds: string[]
  ports: ServicePort[]
  endpoints: Endpoint[]
  provenance: DiscoveryEvidence[]
  /** Actions are available only when the runtime can safely control this service. */
  actions?: EnvironmentServiceAction[]
}
