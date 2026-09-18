// Which Taskflow routes the panel forwards, and what each one needs.
//
// The host daemon answers Taskflow at `/api/modules/taskflow`: the project
// registry at its root, and everything else under the Project's prefix, the way
// the dashboard has always addressed it (`/<prefix>/api/worktrees`). The panel
// serves the same paths to the browser and forwards them one to one, so this
// table is the whole review surface of that second transport (ADR 0047).
//
// Every contract route is named here with a permission: the object below is
// typed against the contract's keys, so a route added to the contract without a
// decision about who may call it does not compile. The routes the contract does
// not describe — the event streams, the upload and the native terminal command —
// follow, and so do the two sockets. `POST /<prefix>/api/runtime/events` is
// deliberately absent: agent hooks on the host report there with the daemon's
// own token, and nothing in a browser has a reason to.
//
// The table imports the contract and nothing that runs, so the parity check in
// `tests/tooling` can read it without starting a server.

import type { Permission } from 'portta-auth-core'
import { apiContract } from 'portta-contracts/taskflow'
import type { ProxyMethod } from '../proxy.ts'

export type TaskflowContractKey = keyof typeof apiContract

/**
 * The permission each contract route needs.
 *
 * The groups follow the manifest's resources. Two choices are worth a word:
 * sending a prompt, uploading, opening terminal tabs and describing a terminal
 * are `terminal:attach`, because each one types into or opens a shell on the
 * host; and the project registry is Portta's own `project:create` and
 * `project:delete`, because registering a directory decides what the daemon
 * serves for everybody, which is a Project administrator's call rather than a
 * developer's. Listing the registry is `worktree:read`: every Taskflow page
 * reads it to find its Project's prefix.
 */
export const TASKFLOW_CONTRACT_PERMISSIONS = {
  fetchConfig: 'worktree:read',
  fetchDiagnostics: 'workspace:read',

  fetchEnvironment: 'workspace:read',
  fetchEnvironmentServices: 'workspace:read',
  fetchEnvironmentLogs: 'workspace:read',
  trustEnvironment: 'workspace:trust',
  startEnvironment: 'workspace:operate',
  stopEnvironment: 'workspace:operate',
  restartEnvironment: 'workspace:operate',
  rebuildEnvironment: 'workspace:operate',
  removeEnvironment: 'workspace:operate',
  controlEnvironmentService: 'workspace:operate',
  execEnvironment: 'terminal:attach',
  openEnvironmentTerminal: 'terminal:attach',
  exposeEnvironmentService: 'workspace:expose',
  removeEndpoint: 'workspace:expose',

  fetchAvailableBranches: 'worktree:read',
  fetchBaseBranches: 'worktree:read',
  fetchProject: 'worktree:read',
  fetchAutoNameConfig: 'worktree:read',

  fetchAgents: 'agent:read',
  createAgent: 'agent:write',
  updateAgent: 'agent:write',
  deleteAgent: 'agent:write',
  validateAgent: 'agent:write',
  fetchAgentsWorktreeConversationHistory: 'agent:read',
  attachAgentsWorktreeConversation: 'agent:write',
  sendAgentsWorktreeConversationMessage: 'agent:write',
  interruptAgentsWorktreeConversation: 'agent:write',

  fetchWorktrees: 'worktree:read',
  fetchWorktreeDiff: 'worktree:read',
  fetchCiLogs: 'worktree:read',
  createWorktree: 'worktree:write',
  openWorktree: 'worktree:write',
  closeWorktree: 'worktree:write',
  refreshWorktreeAgentTerminal: 'worktree:write',
  setWorktreeArchived: 'worktree:write',
  setWorktreeLabel: 'worktree:write',
  setWorktreeProfile: 'worktree:write',
  syncWorktreePrs: 'worktree:write',
  pullMain: 'worktree:write',
  setAutoRemoveOnMerge: 'worktree:write',
  dismissNotification: 'worktree:write',
  removeWorktree: 'worktree:remove',
  mergeWorktree: 'worktree:merge',
  sendWorktreePrompt: 'terminal:attach',
  createWorktreeTab: 'terminal:attach',
  selectWorktreeTab: 'terminal:attach',
  deleteWorktreeTab: 'terminal:attach',

  fetchLinearIssues: 'linear:read',
  setLinearAutoCreate: 'linear:write',
  postWorktreeToLinear: 'linear:write',

  fetchProjectWorkflows: 'workflow:read',
  fetchRunWorkspaceContext: 'run:read',
  fetchProjectRuns: 'run:read',
  fetchRun: 'run:read',
  fetchRunEvents: 'run:read',
  fetchExecutionTranscript: 'run:read',
  createProjectRun: 'run:create',
  resumeRun: 'run:create',
  cancelRun: 'run:cancel',
  respondRunPermission: 'run:permission',

  fetchProjects: 'worktree:read',
  projectInits: 'project:create',
  addProject: 'project:create',
  removeProject: 'project:delete',
} as const satisfies Record<TaskflowContractKey, Permission>

/** The registry, answered at the module root rather than under a Project's prefix. */
export const TASKFLOW_GLOBAL_ROUTES: ReadonlySet<TaskflowContractKey> = new Set([
  'fetchProjects',
  'addProject',
  'projectInits',
  'removeProject',
])

/** The routes the contract does not describe, because their bodies are streams or multipart. */
export const TASKFLOW_EXTRA_ROUTES = [
  { method: 'GET', path: '/api/notifications/stream', permission: 'worktree:read' },
  { method: 'GET', path: '/api/runs/:runId/stream', permission: 'run:read' },
  { method: 'GET', path: '/api/executions/:executionId/transcript/stream', permission: 'run:read' },
  { method: 'GET', path: '/api/worktrees/:name/terminal-launch', permission: 'terminal:attach' },
  { method: 'POST', path: '/api/worktrees/:name/upload', permission: 'terminal:attach' },
] as const satisfies readonly { method: ProxyMethod; path: string; permission: Permission }[]

export interface TaskflowRoute {
  method: ProxyMethod
  /** Below `/api/modules/taskflow`. */
  pattern: string
  permission: Permission
  /** Whether the route names a Project, by the `:prefix` it carries. */
  scoped: boolean
  /** The contract key, or null for a route the contract does not describe. */
  key: TaskflowContractKey | null
}

/** Every HTTP route the panel forwards: the registry first, so a Project called `api` cannot shadow it. */
export const TASKFLOW_ROUTES: readonly TaskflowRoute[] = [
  ...(Object.keys(TASKFLOW_CONTRACT_PERMISSIONS) as TaskflowContractKey[])
    .filter((key) => TASKFLOW_GLOBAL_ROUTES.has(key))
    .map((key) => ({
      method: apiContract[key].method,
      pattern: apiContract[key].path,
      permission: TASKFLOW_CONTRACT_PERMISSIONS[key],
      // Removing a registration is about one Project; listing and adding are not.
      scoped: apiContract[key].path.includes(':prefix'),
      key,
    })),
  ...(Object.keys(TASKFLOW_CONTRACT_PERMISSIONS) as TaskflowContractKey[])
    .filter((key) => !TASKFLOW_GLOBAL_ROUTES.has(key))
    .map((key) => ({
      method: apiContract[key].method,
      pattern: `/:prefix${apiContract[key].path}`,
      permission: TASKFLOW_CONTRACT_PERMISSIONS[key],
      scoped: true,
      key,
    })),
  ...TASKFLOW_EXTRA_ROUTES.map((route) => ({
    method: route.method,
    pattern: `/:prefix${route.path}`,
    permission: route.permission,
    scoped: true,
    key: null,
  })),
]

/**
 * The two sockets, below `/ws/modules/taskflow`.
 *
 * A terminal is a shell on the host; the chat drives the agent of a worktree.
 */
export const TASKFLOW_WS_ROUTES = [
  { path: '/:prefix/ws/agents/worktrees/:name', permission: 'agent:write' },
  { path: '/:prefix/ws/:worktree', permission: 'terminal:attach' },
] as const satisfies readonly { path: string; permission: Permission }[]
