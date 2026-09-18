import { PROJECT_CONFIG_PATH } from 'portta-core/taskflow/config'
import { resolveHostToolThoroughly } from 'portta-host/taskflow/lib/host-tools'
import { run } from 'portta-host/taskflow/lib/shell'

export interface InitDependency {
  args: string[]
  hint: string
  required: boolean
  tool: string
}

export interface InitDependencyStatus extends InitDependency {
  found: boolean
  probeOk: boolean
}

export const INIT_DEPENDENCIES: InitDependency[] = [
  { tool: 'git', args: ['--version'], required: true, hint: 'https://git-scm.com/downloads' },
  { tool: 'node', args: ['--version'], required: true, hint: 'https://nodejs.org/' },
  {
    tool: 'python3',
    args: ['--version'],
    required: true,
    hint: 'https://www.python.org/downloads/  or  brew install python  or  sudo apt install python3',
  },
  { tool: 'tmux', args: ['-V'], required: true, hint: 'brew install tmux / sudo apt install tmux' },
  { tool: 'gh', args: ['--version'], required: false, hint: 'brew install gh  then  gh auth login' },
  {
    tool: 'claude',
    args: ['--version'],
    required: false,
    hint: `Install the Claude Code CLI to let Claude scaffold ${PROJECT_CONFIG_PATH}`,
  },
  {
    tool: 'codex',
    args: ['--version'],
    required: false,
    hint: `Install the Codex CLI to let Codex scaffold ${PROJECT_CONFIG_PATH}`,
  },
  { tool: 'docker', args: ['--version'], required: false, hint: 'https://docs.docker.com/get-started/get-docker/' },
]

export interface InspectInitDependencyOptions {
  resolveTool?: (tool: string) => string | null
  runTool?: (tool: string, args: string[]) => boolean
}

export function inspectInitDependency(
  dep: InitDependency,
  options: InspectInitDependencyOptions = {},
): InitDependencyStatus {
  const resolveTool = options.resolveTool ?? resolveHostToolThoroughly
  const runTool = options.runTool ?? ((tool: string, args: string[]): boolean => run(tool, args).success)
  const path = resolveTool(dep.tool)
  if (!path) return { ...dep, found: false, probeOk: false }
  return { ...dep, found: true, probeOk: runTool(path, dep.args) }
}

export function evaluateInitDependencies(
  deps: readonly InitDependency[] = INIT_DEPENDENCIES,
  options: InspectInitDependencyOptions = {},
): InitDependencyStatus[] {
  return deps.map((dep) => inspectInitDependency(dep, options))
}

export function missingRequiredDependencies(statuses: readonly InitDependencyStatus[]): InitDependencyStatus[] {
  return statuses.filter((status) => status.required && !status.found)
}

export function isInitAgentSelectable(status: Pick<InitDependencyStatus, 'found'>): boolean {
  return status.found
}
