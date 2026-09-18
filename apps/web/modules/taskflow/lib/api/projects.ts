import type { ProjectInitPhase, ProjectInitState, ProjectSummary } from '../types.ts'
import { registryApi } from './client.ts'

/** Why adding a project did not finish, for the reader's language; the server's own message rides along. */
export class ProjectSetupError extends Error {
  readonly reason: 'no-project' | 'failed' | 'timeout'

  constructor(reason: ProjectSetupError['reason'], message: string) {
    super(message)
    this.name = 'ProjectSetupError'
    this.reason = reason
  }
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const response = await registryApi.fetchProjects()
  return response.projects
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SETUP_POLL_INTERVAL_MS = 600
const SETUP_TIMEOUT_MS = 5 * 60_000

/** Register a directory with Taskflow. A repository without `.portta/taskflow.yaml`
 *  is set up first (scaffold, analyse, register), so the call follows that job
 *  until it is ready. Resolves with the new Project's prefix. */
export async function setUpProject(
  path: string,
  onPhase?: (phase: ProjectInitPhase) => void,
): Promise<{ prefix: string }> {
  const res = await registryApi.addProject({ body: { path } })
  if (!res.initializing) {
    if (!res.project)
      throw new ProjectSetupError('no-project', 'Server accepted the project but returned nothing to open.')
    return { prefix: res.project.prefix }
  }

  const deadline = Date.now() + SETUP_TIMEOUT_MS
  let lastPhase: ProjectInitPhase | null = null
  while (Date.now() < deadline) {
    // A transient poll failure shouldn't fail the flow — the backend job keeps
    // running, so swallow it and retry until the deadline.
    const inits = await registryApi
      .projectInits()
      .then((r) => r.inits)
      .catch((): ProjectInitState[] => [])
    const state = inits.find((entry) => entry.path === res.path)
    if (state) {
      if (state.phase !== lastPhase) {
        lastPhase = state.phase
        onPhase?.(state.phase)
      }
      if (state.phase === 'ready' && state.prefix) return { prefix: state.prefix }
      if (state.phase === 'failed') throw new ProjectSetupError('failed', state.error ?? 'Project setup failed.')
    }
    await delay(SETUP_POLL_INTERVAL_MS)
  }
  throw new ProjectSetupError('timeout', 'Project setup timed out.')
}

export async function removeProject(prefix: string): Promise<void> {
  await registryApi.removeProject({ params: { prefix } })
}
