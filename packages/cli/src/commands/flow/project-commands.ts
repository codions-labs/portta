import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProjectInitPhase, ProjectInitState } from 'portta-contracts/taskflow'
import { PROJECT_CONFIG_PATH } from 'portta-core/taskflow/config'
import { daemonBaseUrl, flowApi } from './daemon.ts'
import { type FlowAction, flowInvocation } from './flow-action.ts'
import { formatServerError } from './shared.ts'

const PROJECT_SETUP_POLL_INTERVAL_MS = 700
const PROJECT_SETUP_TIMEOUT_MS = 5 * 60_000

function projectSetupPhaseLabel(phase: ProjectInitPhase): string {
  switch (phase) {
    case 'creating_config':
      return `Creating ${PROJECT_CONFIG_PATH}`
    case 'analyzing':
      return 'Analyzing project structure'
    case 'ready':
      return 'Project ready'
    case 'failed':
      return 'Setup failed'
  }
}

export interface ProjectSetupPoller {
  poll: () => Promise<ProjectInitState[]>
  sleep: (ms: number) => Promise<void>
  log?: (message: string) => void
  now?: () => number
  timeoutMs?: number
}

/** Follow an in-progress on-add project setup to completion, printing each
 *  phase as it changes. Resolves with the ready state (carrying the prefix) or
 *  throws on failure/timeout. Poller is injected so it's testable. */
export async function awaitProjectSetup(path: string, deps: ProjectSetupPoller): Promise<ProjectInitState> {
  const log = deps.log ?? ((message: string): void => console.log(message))
  const now = deps.now ?? Date.now
  const deadline = now() + (deps.timeoutMs ?? PROJECT_SETUP_TIMEOUT_MS)
  let lastPhase: ProjectInitPhase | null = null

  while (now() < deadline) {
    // A transient poll failure shouldn't abort the flow — the backend job keeps
    // running, so just retry until the deadline.
    let state: ProjectInitState | undefined
    try {
      state = (await deps.poll()).find((init) => init.path === path)
    } catch {
      state = undefined
    }
    if (state && state.phase !== lastPhase) {
      lastPhase = state.phase
      if (state.phase !== 'ready' && state.phase !== 'failed') {
        log(`  ${projectSetupPhaseLabel(state.phase)}…`)
      }
    }
    if (state?.phase === 'ready') return state
    if (state?.phase === 'failed') throw new Error(state.error ?? 'Project setup failed.')
    await deps.sleep(PROJECT_SETUP_POLL_INTERVAL_MS)
  }
  throw new Error('Project setup timed out.')
}

export type ParsedProjectCommand =
  | { subcommand: 'ls' }
  | { subcommand: 'add'; path: string }
  | { subcommand: 'rm'; prefix: string }

export function projectFromCli(action: FlowAction): ParsedProjectCommand {
  const [subcommand] = action.path.slice(1)
  if (subcommand === 'add') return { subcommand, path: (action.args[0] as string | undefined) ?? '.' }
  if (subcommand === 'rm') return { subcommand, prefix: String(action.args[0]) }
  return { subcommand: 'ls' }
}

export async function runProjectCommand(parsed: ParsedProjectCommand, port: number): Promise<number> {
  const api = flowApi(daemonBaseUrl(port))
  try {
    if (parsed.subcommand === 'ls') {
      const { projects } = await api.fetchProjects()
      if (projects.length === 0) {
        console.log(`No projects. Add one with: ${flowInvocation()} project add [path]`)
        return 0
      }
      for (const project of projects) {
        const marker = project.active ? '●' : '○'
        console.log(`${marker} ${project.prefix}\t${project.name}\t${project.path}`)
      }
      return 0
    }

    if (parsed.subcommand === 'add') {
      const absolute = resolve(process.cwd(), parsed.path)
      const res = await api.addProject({ body: { path: absolute } })
      if (!res.initializing) {
        if (!res.project) {
          console.error('Server accepted the project but returned nothing to open.')
          return 1
        }
        console.log(`Added ${res.project.name} (${res.project.prefix}) — ${res.project.path}`)
        return 0
      }
      // Repo had no .portta/taskflow.yaml — taskflow is setting it up. Show the phases.
      const ready = await awaitProjectSetup(res.path, {
        poll: async () => (await api.projectInits()).inits,
        sleep: (ms) => delay(ms),
      })
      console.log(`Added ${ready.name ?? ready.prefix} (${ready.prefix}) — ${res.path}`)
      return 0
    }

    await api.removeProject({ params: { prefix: parsed.prefix } })
    console.log(`Removed project: ${parsed.prefix}`)
    return 0
  } catch (error) {
    console.error(formatServerError(error, port))
    return 1
  }
}
