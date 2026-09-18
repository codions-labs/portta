import type {
  AutoNameConfigResponse,
  AvailableBranch,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  FileUploadResult,
  LinearIssuesResponse,
  NativeTerminalLaunch,
  OpenWorktreeRequest,
  PostWorktreeToLinearResponse,
  PostWorktreeToLinearTarget,
  ProjectSnapshot,
  ProjectWorktreeSnapshot,
  PullMainRequest,
  PullMainResult,
  WorktreeInfo,
  WorktreeTab,
} from '../types.ts'
import type { TaskflowClient } from './client.ts'

function mapAgentStatus(status: string): string {
  switch (status) {
    case 'creating':
    case 'running':
    case 'starting':
      return 'working'
    case 'idle':
      return 'waiting'
    case 'stopped':
      return 'done'
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

export function mapWorktree(snapshot: ProjectWorktreeSnapshot): WorktreeInfo {
  return {
    branch: snapshot.branch,
    label: snapshot.label,
    ...(snapshot.baseBranch ? { baseBranch: snapshot.baseBranch } : {}),
    archived: snapshot.archived,
    agent: mapAgentStatus(snapshot.status),
    mux: snapshot.mux ? '✓' : '',
    path: snapshot.path,
    dir: snapshot.dir,
    dirty: snapshot.dirty,
    unpushed: snapshot.unpushed,
    status: snapshot.status,
    elapsed: snapshot.elapsed,
    profile: snapshot.profile,
    agentName: snapshot.agentName,
    interfaceMode: snapshot.interfaceMode ?? 'terminal',
    agentLabel: snapshot.agentLabel,
    agentTerminalStale: snapshot.agentTerminalStale,
    services: snapshot.services,
    paneCount: snapshot.paneCount,
    prs: snapshot.prs,
    linearIssue: snapshot.linearIssue,
    creating: snapshot.creation !== null,
    creationPhase: snapshot.creation?.phase ?? null,
    source: snapshot.source,
    oneshot: snapshot.oneshot,
    tabs: snapshot.tabs,
    activeTabId: snapshot.activeTabId,
    environmentId: snapshot.environmentId ?? null,
  }
}

/** A JSON answer, or the server's `error` as the thrown message. */
async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

export function worktreeApi({ contract, base }: TaskflowClient) {
  const named = (branch: string) => ({ name: branch })
  return {
    fetchProjectSnapshot: (): Promise<ProjectSnapshot> => contract.fetchProject(),
    fetchWorktrees: async (): Promise<WorktreeInfo[]> =>
      (await contract.fetchWorktrees()).worktrees.map((worktree) => mapWorktree(worktree)),
    fetchWorktreeDiff: (branch: string) => contract.fetchWorktreeDiff({ params: named(branch) }),
    fetchAvailableBranches: (includeRemote: boolean): Promise<AvailableBranch[]> =>
      contract.fetchAvailableBranches({ query: { includeRemote } }).then((data) => data.branches),
    fetchBaseBranches: (): Promise<AvailableBranch[]> => contract.fetchBaseBranches().then((data) => data.branches),
    fetchAutoNameConfig: (): Promise<AutoNameConfigResponse> => contract.fetchAutoNameConfig(),
    fetchLinearIssues: (): Promise<LinearIssuesResponse> => contract.fetchLinearIssues(),
    fetchConfig: () => contract.fetchConfig(),
    fetchCiLogs: (runId: string): Promise<string> =>
      contract.fetchCiLogs({ params: { runId } }).then((data) => data.logs),

    createWorktree: (request: CreateWorktreeRequest): Promise<CreateWorktreeResponse> =>
      contract.createWorktree({ body: request }),
    removeWorktree: (branch: string, force = false): Promise<void> =>
      contract.removeWorktree({ params: named(branch), query: force ? { force: true } : {} }).then(() => undefined),
    mergeWorktree: (branch: string): Promise<void> =>
      contract.mergeWorktree({ params: named(branch) }).then(() => undefined),
    openWorktree: (branch: string, interfaceMode: OpenWorktreeRequest['interfaceMode']): Promise<void> =>
      contract.openWorktree({ params: named(branch), body: { interfaceMode } }).then(() => undefined),
    closeWorktree: (branch: string): Promise<void> =>
      contract.closeWorktree({ params: named(branch) }).then(() => undefined),
    setWorktreeArchived: (branch: string, archived: boolean): Promise<void> =>
      contract.setWorktreeArchived({ params: named(branch), body: { archived } }).then(() => undefined),
    syncWorktreePrs: (branch: string) => contract.syncWorktreePrs({ params: named(branch) }).then(mapWorktree),
    pullMain: (request: PullMainRequest): Promise<PullMainResult> => contract.pullMain({ body: request }),
    sendWorktreePrompt: (branch: string, text: string, preamble?: string): Promise<void> =>
      contract
        .sendWorktreePrompt({ params: named(branch), body: { text, ...(preamble ? { preamble } : {}) } })
        .then(() => undefined),
    setLinearAutoCreate: (enabled: boolean): Promise<boolean> =>
      contract.setLinearAutoCreate({ body: { enabled } }).then((data) => data.enabled),
    setAutoRemoveOnMerge: (enabled: boolean): Promise<boolean> =>
      contract.setAutoRemoveOnMerge({ body: { enabled } }).then((data) => data.enabled),

    createWorktreeTab: async (branch: string): Promise<WorktreeTab> =>
      (await contract.createWorktreeTab({ params: named(branch) })).tab,
    selectWorktreeTab: (branch: string, tabId: string): Promise<void> =>
      contract.selectWorktreeTab({ params: { name: branch, tabId } }).then(() => undefined),
    deleteWorktreeTab: (branch: string, tabId: string): Promise<void> =>
      contract.deleteWorktreeTab({ params: { name: branch, tabId } }).then(() => undefined),

    postWorktreeToLinear: (branch: string, target: PostWorktreeToLinearTarget): Promise<PostWorktreeToLinearResponse> =>
      contract.postWorktreeToLinear({ params: named(branch), body: { target } }),
    setWorktreeLabel: async (branch: string, label: string | null): Promise<string | null> =>
      (await contract.setWorktreeLabel({ params: named(branch), body: { label } })).label,
    setWorktreeProfile: async (branch: string, profile: string): Promise<{ profile: string; restarted: boolean }> => {
      const response = await contract.setWorktreeProfile({ params: named(branch), body: { profile } })
      return { profile: response.profile, restarted: response.restarted }
    },
    refreshWorktreeAgentTerminal: (branch: string): Promise<void> =>
      contract.refreshWorktreeAgentTerminal({ params: named(branch) }).then(() => undefined),

    /** Images for a prompt, as multipart `files`; not in the contract because the body is a form. */
    uploadFiles: async (branch: string, files: File[]): Promise<FileUploadResult> => {
      const form = new FormData()
      for (const file of files) form.append('files', file)
      const response = await fetch(`${base}/api/worktrees/${encodeURIComponent(branch)}/upload`, {
        method: 'POST',
        body: form,
      })
      return readJson<FileUploadResult>(response)
    },

    /** The shell command that attaches a native terminal to the worktree's session on the host. */
    fetchNativeTerminalLaunch: async (branch: string): Promise<NativeTerminalLaunch> =>
      readJson<NativeTerminalLaunch>(
        await fetch(`${base}/api/worktrees/${encodeURIComponent(branch)}/terminal-launch`),
      ),
  }
}
