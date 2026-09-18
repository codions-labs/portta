import type { EnvironmentWorkspace, RunRecord } from 'portta-core/taskflow'
import type { WorkspaceBinding } from './workspace-facade.ts'

export interface PrepareRunEnvironmentInput {
  run: RunRecord
  workspace: WorkspaceBinding
  profile: string
}

export type PrepareRunEnvironmentResult =
  | { ok: true; environmentId: string }
  | {
      ok: false
      reason: 'unavailable' | 'selection_required' | 'trust_required'
      diagnostics: string[]
      environmentId?: string
    }

export interface RunEnvironmentPort {
  prepare(input: PrepareRunEnvironmentInput): Promise<PrepareRunEnvironmentResult>
  workspace(environmentId: string): EnvironmentWorkspace
  terminalCommand(environmentId: string, command: string): string
}
