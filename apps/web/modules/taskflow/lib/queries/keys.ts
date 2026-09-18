// Every query key the dashboard uses, minted here so a component, a mutation
// and the live streams agree on what a cache entry is called.
//
// The panel has one query cache for every page, so each key starts with the
// module and the Taskflow Project it is about: two Projects' worktrees are two
// entries, and invalidating `worktrees()` reaches a worktree's diff too.

export function taskflowKeys(prefix: string) {
  const root = ['taskflow', prefix] as const
  return {
    all: () => root,
    config: () => [...root, 'config'] as const,
    snapshot: () => [...root, 'project'] as const,
    autoName: () => [...root, 'auto-name'] as const,

    worktrees: () => [...root, 'worktrees'] as const,
    worktreeDiff: (name: string) => [...root, 'worktrees', name, 'diff'] as const,
    branches: () => [...root, 'branches'] as const,
    availableBranches: (includeRemote: boolean) => [...root, 'branches', includeRemote ? 'remote' : 'local'] as const,
    baseBranches: () => [...root, 'branches', 'base'] as const,
    linearIssues: () => [...root, 'linear', 'issues'] as const,

    workflows: () => [...root, 'workflows'] as const,
    runs: () => [...root, 'runs', 'list'] as const,
    run: (id: string) => [...root, 'runs', 'detail', id] as const,
    /** Outside `runs`: a stream appends to the timeline, and a refetch of the Run must not replay it. */
    runEvents: (id: string) => [...root, 'run-events', id] as const,
    runWorkspaceContext: () => [...root, 'runs', 'workspace-context'] as const,
    executionTranscript: (id: string) => [...root, 'execution-transcripts', id] as const,

    environment: (id: string) => [...root, 'environments', id] as const,
    environmentServices: (id: string) => [...root, 'environments', id, 'services'] as const,

    agents: () => [...root, 'agents'] as const,
  }
}

export type TaskflowKeys = ReturnType<typeof taskflowKeys>

/** The registry is not about one Project. */
export const registryKeys = {
  projects: () => ['taskflow', 'registry'] as const,
}
