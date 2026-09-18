import { globalPaths } from 'portta-core/taskflow/paths'

export function taskflowConfigEnvPath(): string {
  return globalPaths().env
}
