export interface ExecutionWorkspace {
  leaseId: string
  cwd: string
  branch: string
  baseCommit: string
}

export interface ExecutionWorkspaceRequest {
  kind: 'run' | 'fork'
  executionKey: string
  branchSlug?: string
}

export interface ExecutionWorkspaceRelease {
  discard?: boolean
}

export interface ExecutionWorkspaceSummary {
  leaseId: string
  branch: string
  baseCommit: string
  head: string | null
  dirty: boolean
}

/** Owns the worktree leases a Run hands to its agents. It is not a process transport. */
export interface ExecutionPort {
  acquireWorkspace(request: ExecutionWorkspaceRequest): Promise<ExecutionWorkspace>
  releaseWorkspace(leaseId: string, options?: ExecutionWorkspaceRelease): Promise<void>
  summarizeWorkspace(leaseId: string): Promise<ExecutionWorkspaceSummary | null>
}
