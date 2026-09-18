import type { DoctorCheck } from 'portta-core'
import type { ProcessResult, RunOptions } from '../process.js'

export interface ProbeContext {
  locate: (tool: string) => Promise<string | null>
  run: (file: string, args?: readonly string[], options?: RunOptions) => Promise<ProcessResult>
  fileMode: (path: string) => string | null
  homeDir: string
  environment: NodeJS.ProcessEnv
}

export interface EnvironmentProbe {
  id: string
  probe: (context: ProbeContext) => Promise<DoctorCheck[]>
}
