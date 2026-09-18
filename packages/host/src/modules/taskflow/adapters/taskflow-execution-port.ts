import type { AgentId, RuntimeKind } from 'portta-core/taskflow'
import { APP_NAME } from 'portta-core/taskflow/config'
import type { WorkspaceBinding, WorkspaceFacade } from '../services/workspace-facade.ts'
import type {
  ExecutionPort,
  ExecutionWorkspace,
  ExecutionWorkspaceRelease,
  ExecutionWorkspaceRequest,
  ExecutionWorkspaceSummary,
} from '../workflows/index.ts'

export interface TaskflowExecutionPortOptions {
  facade: WorkspaceFacade
  runId: string
  projectRoot: string
  workspaceRoot: string
  profile: string
  agent: AgentId
  runtime: RuntimeKind
  onWorkspaceAcquired?: (workspace: WorkspaceBinding, leaseId: string) => Promise<void>
  onWorkspaceReleased?: (leaseId: string, discard: boolean) => Promise<void>
}

function slugFor(request: ExecutionWorkspaceRequest): string {
  return request.branchSlug ?? request.executionKey
}

export class TaskflowExecutionPort implements ExecutionPort {
  private readonly options: TaskflowExecutionPortOptions
  constructor(options: TaskflowExecutionPortOptions) {
    this.options = options
  }

  async acquireWorkspace(request: ExecutionWorkspaceRequest): Promise<ExecutionWorkspace> {
    if (request.kind !== 'fork') {
      throw new Error(`${APP_NAME} ExecutionPort only provisions fork leases for write fan-out`)
    }
    const result = await this.options.facade.acquireFork({
      leaseId: `lease_${this.options.runId}_${slugFor(request)}`,
      runId: this.options.runId,
      projectRoot: this.options.projectRoot,
      workspaceRoot: this.options.workspaceRoot,
      slug: slugFor(request),
      profile: this.options.profile,
      agent: this.options.agent,
      runtime: this.options.runtime,
    })
    if (!result.ok || result.lease === undefined || result.workspace === null) {
      throw new Error(result.ok ? 'fork lease missing workspace binding' : `fork lease unavailable: ${result.reason}`)
    }
    try {
      await this.options.onWorkspaceAcquired?.(result.workspace, result.lease.id)
    } catch (error: unknown) {
      await this.options.facade.releaseFork(result.lease.id, this.options.projectRoot, true)
      throw error
    }
    return {
      leaseId: result.lease.id,
      cwd: result.workspace.path,
      branch: result.workspace.branch,
      baseCommit: result.workspace.baseCommit,
    }
  }

  async releaseWorkspace(leaseId: string, options: ExecutionWorkspaceRelease = {}): Promise<void> {
    const discard = options.discard === true
    let cleanupError: unknown
    try {
      await this.options.onWorkspaceReleased?.(leaseId, discard)
    } catch (error: unknown) {
      cleanupError = error
    }
    await this.options.facade.releaseFork(leaseId, this.options.projectRoot, discard)
    if (cleanupError) throw cleanupError
  }

  async summarizeWorkspace(leaseId: string): Promise<ExecutionWorkspaceSummary | null> {
    const summary = this.options.facade.summarizeLease(leaseId, this.options.projectRoot)
    return summary
      ? {
          leaseId: summary.leaseId,
          branch: summary.branch,
          baseCommit: summary.baseCommit,
          head: summary.head,
          dirty: summary.dirty,
        }
      : null
  }
}
