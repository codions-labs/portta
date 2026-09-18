import { createHash } from 'node:crypto'
import type {
  EnvironmentProviderId,
  EnvironmentRecord,
  EnvironmentScope,
  ResolvedEnvironment,
  RuntimeSelection,
} from 'portta-core/taskflow'
import { requiresTrust } from '../adapters/environment-provider.ts'

export function selectEnvironmentProvider(
  selection: RuntimeSelection | undefined,
  devcontainerAvailable: boolean,
  configCount: number,
  explicitConfig = false,
  composeAvailable = false,
  dockerfileAvailable = false,
): EnvironmentProviderId | 'selection_required' {
  if (selection === 'host' || selection === 'docker' || selection === 'devcontainer' || selection === 'dockerfile')
    return selection
  if (selection === 'compose') return 'compose'
  if (explicitConfig) return 'devcontainer'
  if (devcontainerAvailable && configCount === 1) return 'devcontainer'
  if (devcontainerAvailable && configCount > 1) return 'selection_required'
  if (composeAvailable) return 'compose'
  return dockerfileAvailable ? 'dockerfile' : 'host'
}

export function environmentRequiresTrust(
  environment: ResolvedEnvironment,
): environment is ResolvedEnvironment & { configRef: string } {
  return Boolean(
    environment.configRef && (environment.provider === 'devcontainer' || requiresTrust(environment.security)),
  )
}

export function environmentIdFor(
  scope: EnvironmentScope,
  provider: EnvironmentProviderId,
  configRef: string | null,
): string {
  const input = [
    scope.installationId,
    scope.userId ?? '',
    scope.projectId,
    scope.workspaceId,
    provider,
    configRef ?? '',
  ].join('\0')
  return `env_${createHash('sha256').update(input).digest('hex').slice(0, 16)}`
}

export function environmentIdForWorkspace(records: EnvironmentRecord[], workspaceId: string): string | null {
  return (
    records.find(
      (record) =>
        record.scope.workspaceId === workspaceId &&
        record.scope.runId === undefined &&
        record.desiredStatus !== 'destroyed',
    )?.id ?? null
  )
}

export function environmentsForInstallation(
  records: EnvironmentRecord[],
  projectId: string,
  installationId: string,
): EnvironmentRecord[] {
  return records.filter(
    (record) => record.scope.projectId === projectId && record.scope.installationId === installationId,
  )
}
