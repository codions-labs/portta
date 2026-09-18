import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentsUiWorktreeConversationResponse } from 'portta-contracts/taskflow'
import {
  type AgentPermissionMode,
  type AgentTransport,
  type PostWorktreeToLinearTarget,
  type StdioMcpServer,
  StdioMcpServerSchema,
} from 'portta-contracts/taskflow'
import type { MultiplexerKind, ProjectSnapshot, RunEventRecord, WorktreeSnapshot } from 'portta-core/taskflow'
import { RUNTIME_IDENTITY } from 'portta-core/taskflow/config'
import { globalPaths } from 'portta-core/taskflow/paths'
import { ClaudeCliClient } from '../adapters/claude-cli.ts'
import { CodexAppServerClient } from '../adapters/codex-app-server.ts'
import {
  getDefaultProfileName,
  type ProjectConfig,
  persistLocalGitHubConfig,
  persistLocalLinearConfig,
} from '../adapters/config.ts'
import type { DevContainerProvider } from '../adapters/devcontainer-environment.ts'
import type { DockerfileEnvironmentProvider } from '../adapters/dockerfile-environment.ts'
import type { EndpointExposureProvider } from '../adapters/endpoint-exposure.ts'
import type { EnvironmentStore } from '../adapters/environment-store.ts'
import { readWorktreeMeta, writeWorktreeMeta } from '../adapters/fs.ts'
import { canonicalizeFsPath, sameFsPath } from '../adapters/git.ts'
import type { HostEnvironmentProvider } from '../adapters/host-environment.ts'
import type { NodeProcessRunner } from '../adapters/process-runner.ts'
import { getSharedRunStore, type RunStore } from '../adapters/run-store.ts'
import { TaskflowExecutionPort } from '../adapters/taskflow-execution-port.ts'
import type { TerminalAttachTarget } from '../adapters/terminal.ts'
import { startSerializedInterval } from '../lib/async.ts'
import { errorResponse, jsonResponse } from '../lib/http.ts'
import { log } from '../lib/log.ts'
import type { TaskflowRuntime } from '../runtime.ts'
import { AcpDirectSessionService, RoutingDirectSessionService } from '../services/acp-direct-session-service.ts'
import { resolveAcpProviders } from '../services/acp-providers.ts'
import { AcpWorkerFactory } from '../services/acp-worker-factory.ts'
import { resolveAgentChatSupport, resolveAgentTerminalSubmitDelayMs } from '../services/agent-chat-service.ts'
import { getAgentDefinition, listAgentSummaries } from '../services/agent-registry.ts'
import { AgentSupervisorClient } from '../services/agent-supervisor-client.ts'
import { classifyAgentsTerminalWorktreeError } from '../services/agents-ui-action-service.ts'
import { buildArchivedWorktreePathSet, normalizeArchivePath } from '../services/archive-service.ts'
import { startAutoPullMonitor } from '../services/auto-pull-service.ts'
import { type AutoRemoveDependencies, runAutoRemove } from '../services/auto-remove-service.ts'
import { ClaudeConversationService, isPendingClaudeConversationId } from '../services/claude-conversation-service.ts'
import { ClaudeConversationStreamService } from '../services/claude-conversation-stream-service.ts'
import {
  buildClaudeStreamingLaunchContext,
  type ClaudeStreamingLaunchContext,
} from '../services/claude-streaming-launch-service.ts'
import {
  buildSeedFromLinear,
  defaultSeedFromLinearDeps,
  type ExportConversationDependencies,
  type ExportConversationInput,
  exportConversationToLinear,
} from '../services/conversation-export-service.ts'
import { hasRecentDashboardActivity } from '../services/dashboard-activity.ts'
import { readDeclaredProjectConfig } from '../services/declared-project.ts'
import { environmentIdForWorkspace } from '../services/environment-coordinator.ts'
import { EnvironmentDiagnosticsService } from '../services/environment-diagnostics-service.ts'
import type { DockerServiceDiscoverySource } from '../services/environment-service-discovery.ts'
import { RoutingEnvironmentWorkerFactory } from '../services/environment-worker-factory.ts'
import { ExecutionTranscriptService } from '../services/execution-transcript-service.ts'
import { LifecycleError } from '../services/lifecycle-service.ts'
import { resetProcessedIssues, startLinearAutoCreateMonitor } from '../services/linear-auto-create-service.ts'
import {
  attachToIssue,
  branchMatchesIssue,
  buildLinearPickupMarkdown,
  createIssueComment,
  createLinearIssue,
  fetchAssignedIssues,
  fetchIssueWithAttachments,
  fetchTeamByKey,
  uploadAttachmentFile,
} from '../services/linear-service.ts'
import { startOneshotWatcher } from '../services/oneshot-watcher-service.ts'
import { fetchBranchPrStates, startAutoRemoveMonitor, startPrMonitor } from '../services/pr-service.ts'
import { RunPresentationService } from '../services/run-presentation-service.ts'
import { RunService } from '../services/run-service.ts'
import { startSessionSnapshotMonitor } from '../services/session-restore-service.ts'
import { buildProjectSnapshot } from '../services/snapshot-service.ts'
import { TaskflowDirectSessionService } from '../services/taskflow-direct-session-service.ts'
import { WorkflowCatalogService } from '../services/workflow-catalog-service.ts'
import { WorkflowEventBridge } from '../services/workflow-event-bridge.ts'
import { NodeWorkflowRunner } from '../services/workflow-runner.ts'
import { WorkspaceFacade } from '../services/workspace-facade.ts'
import {
  resolveCodexAppServerLaunchContext,
  WorktreeConversationService,
} from '../services/worktree-conversation-service.ts'
import { BUILTIN_PROVIDER_IDS } from '../workflows/index.ts'
import { createProjectEnvironments, type ProjectEnvironments } from './project-environments.ts'

export type WorktreePostToLinearOutcome =
  | { ok: true; data: { issueId: string; issueUrl: string; commentUrl: string | null; attachmentUrl: string } }
  | { ok: false; error: string; status: number }

export interface ProjectRuns {
  service: RunService
  presentation: RunPresentationService
  transcripts: ExecutionTranscriptService
  workflowCatalog: WorkflowCatalogService
  store: RunStore
  /** Where workflow journals and snapshots are written. */
  dataRoot: string
  /** Follow every Run event this Project publishes; returns the unsubscribe. */
  subscribe(listener: (event: RunEventRecord) => void): () => void
}

export interface FrontendConfig {
  name: string
  services: ProjectConfig['services']
  profiles: Array<{ name: string; systemPrompt?: string }>
  agents: ReturnType<typeof listAgentSummaries>
  defaultProfileName: string
  defaultAgentId: ProjectConfig['workspace']['defaultAgent']
  autoName: boolean
  linearCreateTicketOption: boolean
  startupEnvs: ProjectConfig['startupEnvs']
  linkedRepos: Array<{ alias: string; dir?: string }>
  linearAutoCreateWorktrees: boolean
  autoRemoveOnMerge: boolean
  projectDir: string
  mainBranch: string
  branchPattern: string
  multiplexer: MultiplexerKind
  build: { version: string; builtAt: string }
}

/** What every Project app shares with the host that serves it. */
export interface ProjectHost {
  /** The port the host listens on; part of tmux and environment identities. */
  port: number
  workflowBuiltinsDir: string
  version: string
  buildDate: string
  environmentStore: EnvironmentStore
  hostEnvironmentProvider: HostEnvironmentProvider
  devContainerProvider: DevContainerProvider
  dockerfileEnvironmentProvider: DockerfileEnvironmentProvider
  processRunner: NodeProcessRunner
  dockerServiceDiscovery: DockerServiceDiscoverySource
  endpointExposure: EndpointExposureProvider
}

interface WorkflowAgentRuntimeConfig {
  transport: AgentTransport
  permissionMode: AgentPermissionMode
  mcpServers: StdioMcpServer[]
}

function workflowAgentRuntimeConfig(value: unknown): WorkflowAgentRuntimeConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { transport: 'native', permissionMode: 'workspace', mcpServers: [] }
  }
  const config = value as Record<string, unknown>
  const transport = config.transport === 'acp' ? 'acp' : 'native'
  const permissionMode =
    config.permissionMode === 'interactive' || config.permissionMode === 'deny' ? config.permissionMode : 'workspace'
  const mcpServers = StdioMcpServerSchema.array().safeParse(config.mcpServers)
  return { transport, permissionMode, mcpServers: mcpServers.success ? mcpServers.data : [] }
}

/** Everything one Project exposes to the host's HTTP routes and WebSockets,
 *  plus its light background-loop controls. Built by `createProjectApp` and
 *  bound to exactly one `TaskflowRuntime`; the host serves it under `/${prefix}`. */
export interface ProjectApp {
  prefix: string
  /** The configuration the dashboard reads. */
  frontendConfig(): FrontendConfig
  diagnostics: EnvironmentDiagnosticsService
  environments: ProjectEnvironments
  runtime: TaskflowRuntime
  /** Reconcile, then read the Project snapshot the dashboard renders. */
  readProjectSnapshot(): Promise<ProjectSnapshot>
  worktreeConversationService: WorktreeConversationService
  claudeConversationService: ClaudeConversationService
  claudeConversationStreamService: ClaudeConversationStreamService
  resolveAgentsWorktree(
    branch: string,
  ): Promise<{ ok: true; worktree: WorktreeSnapshot } | { ok: false; response: Response }>
  resolveWorktreeAgentChatSupport(
    worktree: WorktreeSnapshot,
    action: 'chat' | 'interrupt',
  ): ReturnType<typeof resolveAgentChatSupport>
  withClaudeLiveConversation(response: AgentsUiWorktreeConversationResponse): AgentsUiWorktreeConversationResponse
  setAgentTerminalStale(worktree: WorktreeSnapshot, stale: boolean): Promise<void>
  /** Start a backend-owned Claude turn; `null` when the worktree has no streaming launch context. */
  sendClaudeStreamingMessage(input: {
    worktree: WorktreeSnapshot
    text: string
    conversationId: string
  }): Promise<Response | null>
  resolveAgentsTerminalWorktree(
    branch: string,
  ): Promise<
    { ok: true; data: { worktreeId: string; attachTarget: TerminalAttachTarget } } | { ok: false; response: Response }
  >
  /** Clear the oneshot watch of a worktree: a person took over. */
  disarmOneshotIfArmed(branch: string, reason: string): Promise<void>
  /** The port the host listens on. */
  port: number
  /** Refuse a worktree that is being removed, created or having its tabs rewritten. */
  ensureBranchNotBusy(branch: string): void
  withRemovingBranch<T>(branch: string, fn: () => Promise<T>): Promise<T>
  /** Serialize every rewrite of a worktree's tabs (and exclude remove/create). */
  withMutatingTab<T>(branch: string, fn: () => Promise<T>): Promise<T>
  setBranchAgentLifecycle(branch: string, lifecycle: 'running' | 'stopped'): void
  resolveTerminalWorktree(
    branch: string,
  ): Promise<{ worktreeId: string; attachTarget: TerminalAttachTarget; agentName: WorktreeSnapshot['agentName'] }>
  resolveWorktreeTerminalSubmitDelayMs(agentName: WorktreeSnapshot['agentName']): number
  processRunner: NodeProcessRunner
  /** Toggle worktree creation from Linear issues, persisted to the local config. */
  setLinearAutoCreateEnabled(enabled: boolean): Promise<boolean>
  /** Toggle worktree removal after a merged pull request, persisted to the local config. */
  setAutoRemoveOnMergeEnabled(enabled: boolean): Promise<boolean>
  postWorktreeConversationToLinear(
    branch: string,
    target: PostWorktreeToLinearTarget,
  ): Promise<WorktreePostToLinearOutcome>
  getWorktreeGitDirs(): Promise<Map<string, string>>
  runs: ProjectRuns
  codexAppServerClient: CodexAppServerClient
  startLight(): void
  stopLight(): void
  shutdownRuns(): Promise<void>
}

export function createProjectApp(runtime: TaskflowRuntime, instancePrefix: string, host: ProjectHost): ProjectApp {
  const {
    port: PORT,
    workflowBuiltinsDir: WORKFLOW_BUILTINS_DIR,
    version: PORTTA_FLOW_VERSION,
    buildDate: PORTTA_FLOW_BUILD_DATE,
  } = host
  const PROJECT_DIR = runtime.projectDir
  const installationId = `${RUNTIME_IDENTITY.tmuxPrefix}-${PORT}`
  const config: ProjectConfig = runtime.config
  // Builtins plus the Project's `providers:`; every ACP Run of this app names ids from this map.
  const acpProviders = resolveAcpProviders(config.providers)
  const git = runtime.git
  const archiveStateService = runtime.archiveStateService
  const sessions = runtime.sessions
  const projectRuntime = runtime.projectRuntime
  const worktreeCreationTracker = runtime.worktreeCreationTracker
  const runtimeNotifications = runtime.runtimeNotifications
  const reconciliationService = runtime.reconciliationService
  const codexAppServerClient = new CodexAppServerClient({
    clientName: RUNTIME_IDENTITY.codexClientName,
    clientVersion: PORTTA_FLOW_VERSION,
  })
  const claudeCliClient = new ClaudeCliClient()
  const worktreeConversationService = new WorktreeConversationService({
    appServer: codexAppServerClient,
    git,
    resolveLaunchContext: ({ worktree, meta }) =>
      resolveCodexAppServerLaunchContext({
        worktree,
        meta,
        profile: config.profiles[meta.profile],
      }),
  })
  const claudeConversationService = new ClaudeConversationService({
    claude: claudeCliClient,
    git,
  })
  const claudeConversationStreamService = new ClaudeConversationStreamService({
    claude: claudeCliClient,
  })
  const removingBranches = new Set<string>()
  const mutatingTabBranches = new Set<string>()
  const lifecycleService = runtime.lifecycleService
  const environments = createProjectEnvironments({
    projectId: instancePrefix,
    installationId,
    projectDir: PROJECT_DIR,
    config,
    projectRuntime,
    docker: runtime.docker,
    host,
  })
  const {
    prepareWorkspaceEnvironment,
    environmentForProject,
    projectEnvironments,
    environmentTransport,
    terminalCommandForEnvironment,
    workspaceForEnvironment,
    destroyEnvironmentRecord,
    reconcileProjectEnvironments,
  } = environments
  const runStore = runtime.runStore ?? getSharedRunStore()
  const runEventListeners = new Set<(event: RunEventRecord) => void>()
  const runEventPublisher = {
    publish: (event: RunEventRecord): void => {
      runEventListeners.forEach((listener) => {
        listener(event)
      })
    },
  }
  const workflowEvents = new WorkflowEventBridge({ store: runStore, publisher: runEventPublisher })
  const workspaces = new WorkspaceFacade({ store: runStore, git })
  const workflowDataRoot = globalPaths().root
  const supervisorSocket = join(workflowDataRoot, 'runtime', 'supervisor.sock')
  const supervisor = new AgentSupervisorClient({
    socketPath: supervisorSocket,
    startDaemon: (): void => {
      const directory = dirname(fileURLToPath(import.meta.url))
      const builtEntry = join(directory, 'supervisor.js')
      const sourceEntry = join(directory, 'supervisor.ts')
      const child = existsSync(builtEntry)
        ? spawn(process.execPath, [builtEntry], { detached: true, stdio: 'ignore' })
        : spawn(process.execPath, ['--import', 'tsx', sourceEntry], { detached: true, stdio: 'ignore' })
      child.unref()
    },
  })
  const nativeDirectSessions = new TaskflowDirectSessionService({
    config,
    projectRoot: PROJECT_DIR,
    sessions: runtime.sessions,
    sessionDiscovery: runtime.sessionDiscovery,
    environments: {
      workspace: workspaceForEnvironment,
      terminalCommand: terminalCommandForEnvironment,
    },
  })
  const acpDirectSessions = new AcpDirectSessionService({
    supervisor,
    projectRoot: PROJECT_DIR,
    sessions: runtime.sessions,
    resolveRoute: (environmentId, workspacePath) => {
      const environment = environmentId ? environmentForProject(environmentId) : null
      if (environment?.status !== 'ready') throw new Error('ACP execution environment is not ready')
      const transport = environmentTransport(environment)
      if (!transport) throw new Error(`Environment transport is unavailable: ${environment.provider}`)
      return {
        handle: environment,
        transport,
        cwd: environment.workspace.containerPath ?? workspacePath,
      }
    },
  })
  const workflowEnvironmentPaths = new Map<string, Map<string, string>>()
  const workflowLeasePaths = new Map<string, Map<string, string>>()
  const runService =
    runtime.runService ??
    new RunService({
      store: runStore,
      workspaces,
      directSessions: new RoutingDirectSessionService(nativeDirectSessions, acpDirectSessions),
      environments: {
        prepare: ({ run, workspace, profile }) =>
          prepareWorkspaceEnvironment({
            workspacePath: workspace.path,
            workspaceId: workspace.workspaceId,
            profileName: profile,
            runId: run.id,
            start: true,
          }),
        workspace: workspaceForEnvironment,
        terminalCommand: terminalCommandForEnvironment,
      },
      workflowRunner: new NodeWorkflowRunner({
        knownProviders: (spec) =>
          workflowAgentRuntimeConfig(spec.spec.agentRuntime).transport === 'acp'
            ? [...acpProviders.keys()]
            : BUILTIN_PROVIDER_IDS,
        createWorkerFactory: (spec) => {
          const agentRuntime = workflowAgentRuntimeConfig(spec.spec.agentRuntime)
          if (agentRuntime.transport === 'acp') {
            if (!spec.spec.environmentId) throw new Error('ACP workflow has no execution environment')
            const paths = new Map([[canonicalizeFsPath(spec.spec.cwd), spec.spec.environmentId]])
            workflowEnvironmentPaths.set(spec.runId, paths)
            return new AcpWorkerFactory(
              supervisor,
              acpProviders,
              spec.runId,
              agentRuntime.permissionMode,
              agentRuntime.mcpServers,
              (cwd) => {
                const environmentId = paths.get(canonicalizeFsPath(cwd))
                const environment = environmentId ? environmentForProject(environmentId) : null
                if (!environment) throw new Error(`No execution environment contains workflow cwd: ${cwd}`)
                return {
                  cwd: environment.workspace.containerPath ?? cwd,
                  execution: {
                    provider: environment.provider,
                    hostPath: environment.workspace.hostPath,
                    containerPath: environment.workspace.containerPath ?? null,
                    containerRef:
                      typeof environment.providerRef.value.containerId === 'string'
                        ? environment.providerRef.value.containerId
                        : typeof environment.providerRef.value.containerName === 'string'
                          ? environment.providerRef.value.containerName
                          : null,
                  },
                }
              },
              () => {
                workflowEnvironmentPaths.delete(spec.runId)
                workflowLeasePaths.delete(spec.runId)
              },
            )
          }
          if (spec.spec.fake || !spec.spec.environmentId) return undefined
          const record = environmentForProject(spec.spec.environmentId)
          if (record?.status !== 'ready' || record.provider === 'host') return undefined
          const paths = new Map([[canonicalizeFsPath(spec.spec.cwd), record.id]])
          workflowEnvironmentPaths.set(spec.runId, paths)
          return new RoutingEnvironmentWorkerFactory(
            (cwd) => {
              const environmentId = paths.get(canonicalizeFsPath(cwd))
              if (!environmentId) throw new Error(`No environment is assigned to workflow workspace: ${cwd}`)
              const environment = environmentForProject(environmentId)
              if (environment?.status !== 'ready') throw new Error(`Environment is not ready: ${environmentId}`)
              const transport = environmentTransport(environment)
              if (!transport) throw new Error(`Environment transport is unavailable: ${environment.provider}`)
              return { handle: environment, transport }
            },
            () => {
              workflowEnvironmentPaths.delete(spec.runId)
              workflowLeasePaths.delete(spec.runId)
            },
          )
        },
        createExecutionPort: (spec) => {
          const { projectRoot, workspaceRoot, profile, agent, runtime } = spec.spec
          if (!projectRoot || !workspaceRoot || !profile || !agent || (runtime !== 'host' && runtime !== 'docker'))
            return undefined
          return new TaskflowExecutionPort({
            facade: workspaces,
            runId: spec.runId,
            projectRoot,
            workspaceRoot,
            profile,
            agent,
            runtime,
            onWorkspaceAcquired: async (workspace, leaseId) => {
              const prepared = await prepareWorkspaceEnvironment({
                workspacePath: workspace.path,
                workspaceId: workspace.workspaceId,
                profileName: profile,
                runId: spec.runId,
                start: true,
              })
              if (!prepared.ok) {
                throw new Error(`fork environment ${prepared.reason}: ${prepared.diagnostics.join('; ')}`)
              }
              workflowEnvironmentPaths.get(spec.runId)?.set(workspace.canonicalPath, prepared.environmentId)
              const leases = workflowLeasePaths.get(spec.runId) ?? new Map<string, string>()
              leases.set(leaseId, workspace.canonicalPath)
              workflowLeasePaths.set(spec.runId, leases)
            },
            onWorkspaceReleased: async (leaseId) => {
              const leases = workflowLeasePaths.get(spec.runId)
              const path = leases?.get(leaseId)
              const environments = workflowEnvironmentPaths.get(spec.runId)
              const environmentId = path ? environments?.get(path) : undefined
              try {
                const environment = environmentId ? environmentForProject(environmentId) : null
                if (environment) await destroyEnvironmentRecord(environment)
              } finally {
                if (path) environments?.delete(path)
                leases?.delete(leaseId)
              }
            },
          })
        },
      }),
      workflowEvents,
      eventPublisher: runEventPublisher,
      workflowOperationsActive: (runId) =>
        supervisor
          .list(`${runId}:`)
          .then((operations) =>
            operations.some((operation) => ['starting', 'running', 'waiting_input'].includes(operation.status)),
          ),
    })
  const runPresentation = new RunPresentationService(runStore)
  const executionTranscripts = new ExecutionTranscriptService(runStore, runtime.sessionDiscovery)
  const workflowCatalog = new WorkflowCatalogService({
    builtinRoot: WORKFLOW_BUILTINS_DIR,
    taskflowHome: globalPaths().root,
    projectRoot: PROJECT_DIR,
  })
  const environmentDiagnostics = new EnvironmentDiagnosticsService({
    config,
    linearProbe: async () => {
      const result = await fetchAssignedIssues({ skipCache: true })
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
  })
  let linearAutoCreateEnabled = config.integrations.linear.autoCreateWorktrees
  let stopLinearAutoCreate: (() => void) | null = null
  let autoRemoveOnMergeEnabled = config.integrations.github.autoRemoveOnMerge
  let stopPrMonitor: (() => void) | null = null
  let stopAutoRemoveMonitor: (() => void) | null = null
  let stopOneshotWatcher: (() => void) | null = null
  let stopAutoPullMonitor: (() => void) | null = null
  let stopSessionSnapshot: (() => void) | null = null
  let stopRunReconciliation: (() => void) | null = null

  /** Create a worktree in oneshot mode for the given Linear issue and arm the
   *  server-side watcher to post results back + close the session when done. Returns
   *  the resolved working branch — the seed may pick `attachmentPayload.branch ??
   *  pr.branch ?? issue.branchName`, so the caller (e.g. the pickup-comment poster)
   *  must use this value, not `issue.branchName`. */
  async function runOneshotForIssue(issueId: string): Promise<{ branch: string }> {
    const seed = await buildSeedFromLinear({ issueId }, defaultSeedFromLinearDeps)
    if (!seed.ok) {
      throw new Error(`Linear seed failed for ${issueId}: ${seed.error}`)
    }

    const branch = seed.data.branch
    if (!branch) {
      throw new Error(`Linear seed for ${issueId} did not resolve to a branch`)
    }
    const mode = seed.data.source !== 'none' ? 'existing' : 'new'
    const prompt = seed.data.conversationMarkdown?.trim() ?? ''

    await lifecycleService.createWorktree({
      mode,
      branch,
      ...(prompt ? { prompt } : {}),
      source: 'oneshot',
      oneshot: {
        autoCloseOnDone: true,
        postToLinearOnDone: { kind: 'issue', issueId },
      },
    })
    const worktree = projectRuntime.getWorktreeByBranch(branch)
    if (worktree) {
      const environment = await prepareWorkspaceEnvironment({
        workspacePath: worktree.path,
        workspaceId: worktree.worktreeId,
        profileName: worktree.profile,
        start: true,
      })
      if (!environment.ok) {
        log.info(
          `[environment:prepare] branch=${branch} status=${environment.reason} ${environment.diagnostics.join('; ')}`,
        )
      }
    }
    if (prompt) setBranchAgentLifecycle(branch, 'running')
    return { branch }
  }

  /** Safe to call multiple times — the guard prevents duplicate monitors. */
  function startLinearAutoCreate(): void {
    if (stopLinearAutoCreate) return
    const watchTeamKeys = config.integrations.linear.watchTeams
    stopLinearAutoCreate = startLinearAutoCreateMonitor({
      lifecycleService,
      git,
      projectRoot: PROJECT_DIR,
      runOneshotForIssue,
      onOneshotPickedUp: postLinearOneshotPickupComment,
      ...(watchTeamKeys && watchTeamKeys.length > 0 ? { watchTeamKeys } : {}),
    })
  }

  /** Post the structured pickup comment on the Linear issue when the auto-create watcher
   *  picks up a `taskflow_oneshot` issue, so external automation can see the autonomous run
   *  started. `branch` is the *actual* working branch (which can differ from
   *  `issue.branchName` — see `runOneshotForIssue`). Failures are logged and swallowed —
   *  pickup itself must not depend on this. Markdown is built by the pure
   *  `buildLinearPickupMarkdown` in `linear-service.ts` so the grep-able prefix has a
   *  unit-test contract. */
  async function postLinearOneshotPickupComment(input: {
    issue: { id: string; identifier: string }
    branch: string
  }): Promise<void> {
    const body = buildLinearPickupMarkdown({
      branch: input.branch,
      pickedUpAt: new Date(),
    })
    const result = await createIssueComment({ issueId: input.issue.id, body })
    if (!result.ok) {
      log.warn(`[linear-auto-create] failed to post pickup comment for ${input.issue.identifier}: ${result.error}`)
      return
    }
    log.info(`[linear-auto-create] posted pickup comment for ${input.issue.identifier}: ${result.data.url}`)
  }

  /** Map the wire-side `OneshotConfig` (all-optional fields) to the persisted
   *  `OneshotMeta` shape (autoCloseOnDone has a definite boolean). Default is
   *  `true` — callers must opt out explicitly. */
  /** Clear the worktree's oneshot watch state, if armed. Called from every
   *  user-interaction endpoint so any browser action ("the human took over")
   *  short-circuits the server-side auto-close + Linear post-back. Also updates
   *  the in-memory runtime state so the next snapshot reflects the disarm without
   *  waiting for a reconciliation pass — the CLI relies on that for its
   *  user-took-over exit path. */
  async function disarmOneshotIfArmed(branch: string, reason: string): Promise<void> {
    try {
      const disarmed = await lifecycleService.disarmOneshot(branch)
      if (!disarmed) return
      log.info(`[oneshot-watcher] ${branch}: disarmed by ${reason}`)
      const state = projectRuntime.getWorktreeByBranch(branch)
      if (state) projectRuntime.setOneshot(state.worktreeId, null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn(`[oneshot-watcher] disarm failed for ${branch} (${reason}): ${msg}`)
    }
  }

  function stopLinearAutoCreateMonitor(): void {
    if (stopLinearAutoCreate) {
      stopLinearAutoCreate()
      stopLinearAutoCreate = null
    }
  }

  const autoRemoveDeps: AutoRemoveDependencies = {
    lifecycleService,
    git,
    projectRoot: PROJECT_DIR,
    notifications: runtimeNotifications,
    isRemoving: (branch: string) => removingBranches.has(branch),
    markRemoving: (branch: string) => removingBranches.add(branch),
    unmarkRemoving: (branch: string) => removingBranches.delete(branch),
    getBranchPrStates: () => fetchBranchPrStates(config.integrations.github.linkedRepos, PROJECT_DIR),
  }

  function getFrontendConfig(): FrontendConfig {
    const defaultProfileName = getDefaultProfileName(config)
    const orderedProfileEntries = Object.entries(config.profiles).sort(([left], [right]) => {
      if (left === defaultProfileName) return -1
      if (right === defaultProfileName) return 1
      return 0
    })

    return {
      name: config.name,
      services: config.services,
      profiles: orderedProfileEntries.map(([name, profile]) => ({
        name,
        ...(profile.systemPrompt ? { systemPrompt: profile.systemPrompt } : {}),
      })),
      agents: listAgentSummaries(config),
      defaultProfileName,
      defaultAgentId: config.workspace.defaultAgent,
      autoName: config.autoName !== null,
      linearCreateTicketOption: config.integrations.linear.enabled && config.integrations.linear.createTicketOption,
      startupEnvs: config.startupEnvs,
      linkedRepos: config.integrations.github.linkedRepos.map((lr) => ({
        alias: lr.alias,
        ...(lr.dir ? { dir: resolve(PROJECT_DIR, lr.dir) } : {}),
      })),
      linearAutoCreateWorktrees: linearAutoCreateEnabled,
      autoRemoveOnMerge: autoRemoveOnMergeEnabled,
      projectDir: PROJECT_DIR,
      mainBranch: config.workspace.mainBranch,
      branchPattern: readDeclaredProjectConfig(PROJECT_DIR).worktrees.branchPattern,
      multiplexer: config.multiplexer,
      build: { version: PORTTA_FLOW_VERSION, builtAt: PORTTA_FLOW_BUILD_DATE },
    }
  }

  // --- HTTP helpers ---

  /** Send a WsOutboundMessage. Hot-path messages (output/scrollback) use a
   *  single-character prefix to avoid JSON encode/decode overhead. */
  /** Wrap an async API handler to catch and log unhandled errors. */
  function ensureBranchNotRemoving(branch: string): void {
    if (removingBranches.has(branch)) {
      throw new LifecycleError(`Worktree is being removed: ${branch}`, 409)
    }
  }

  function ensureBranchNotCreating(branch: string): void {
    if (worktreeCreationTracker.has(branch)) {
      throw new LifecycleError(`Worktree is being created: ${branch}`, 409)
    }
  }

  function ensureBranchNotMutatingTab(branch: string): void {
    if (mutatingTabBranches.has(branch)) {
      throw new LifecycleError(`Worktree tabs are being updated: ${branch}`, 409)
    }
  }

  function ensureBranchNotBusy(branch: string): void {
    ensureBranchNotRemoving(branch)
    ensureBranchNotCreating(branch)
    ensureBranchNotMutatingTab(branch)
  }

  async function withRemovingBranch<T>(branch: string, fn: () => Promise<T>): Promise<T> {
    ensureBranchNotBusy(branch)
    removingBranches.add(branch)
    try {
      return await fn()
    } finally {
      removingBranches.delete(branch)
    }
  }

  // Tab create/select/delete each read-modify-write the worktree meta. Open and
  // agent-terminal refresh also rewrite the whole tabs array (via restoreWorktreeTabs).
  // Serialize them all per branch (and mutually exclude with remove/create) so concurrent
  // requests from the CLI or multiple clients can't clobber each other's tab bookkeeping.
  async function withMutatingTab<T>(branch: string, fn: () => Promise<T>): Promise<T> {
    ensureBranchNotBusy(branch)
    mutatingTabBranches.add(branch)
    try {
      return await fn()
    } finally {
      mutatingTabBranches.delete(branch)
    }
  }

  async function resolveTerminalWorktree(branch: string): Promise<{
    worktreeId: string
    attachTarget: TerminalAttachTarget
    agentName: WorktreeSnapshot['agentName']
  }> {
    ensureBranchNotBusy(branch)
    let state = projectRuntime.getWorktreeByBranch(branch)
    if (!state?.session.exists || !state.session.sessionName) {
      await reconciliationService.reconcile(PROJECT_DIR)
      state = projectRuntime.getWorktreeByBranch(branch)
    }
    if (!state) {
      throw new Error(`Worktree not found: ${branch}`)
    }
    if (!state.session.exists || !state.session.sessionName) {
      throw new Error(`No open tmux window found for worktree: ${branch}`)
    }

    return {
      worktreeId: state.worktreeId,
      attachTarget: {
        ownerSessionName: state.session.sessionName,
        windowName: state.session.windowName,
      },
      agentName: state.agentName,
    }
  }

  async function resolveAgentsTerminalWorktree(branch: string): Promise<
    | {
        ok: true
        data: {
          worktreeId: string
          attachTarget: TerminalAttachTarget
        }
      }
    | {
        ok: false
        response: Response
      }
  > {
    try {
      return {
        ok: true,
        data: await resolveTerminalWorktree(branch),
      }
    } catch (error) {
      const classified = classifyAgentsTerminalWorktreeError(error)
      if (!classified) throw error
      return {
        ok: false,
        response: errorResponse(classified.error, classified.status),
      }
    }
  }

  // --- Process helpers ---

  async function getWorktreeGitDirs(): Promise<Map<string, string>> {
    const gitDirs = new Map<string, string>()
    const projectRoot = resolve(PROJECT_DIR)
    for (const entry of git.listLiveWorktrees(projectRoot)) {
      if (entry.bare || sameFsPath(entry.path, projectRoot) || !entry.branch) continue
      gitDirs.set(entry.branch, git.resolveWorktreeGitDir(entry.path))
    }
    return gitDirs
  }

  async function readProjectSnapshot(): Promise<ProjectSnapshot> {
    const linearApiKey = process.env.LINEAR_API_KEY
    const linearIssuesPromise =
      config.integrations.linear.enabled && linearApiKey?.trim()
        ? fetchAssignedIssues()
        : Promise.resolve({ ok: true as const, data: [] })
    await reconciliationService.reconcile(PROJECT_DIR)
    const archiveState = await archiveStateService.prune(
      projectRuntime.listWorktrees().map((worktree) => worktree.path),
    )
    const linearResult = await linearIssuesPromise
    const archivedPaths = buildArchivedWorktreePathSet(archiveState)
    const linearIssues = linearResult.ok ? linearResult.data : []
    const snapshot = buildProjectSnapshot({
      projectName: config.name,
      mainBranch: config.workspace.mainBranch,
      runtime: projectRuntime,
      creatingWorktrees: worktreeCreationTracker.list(),
      notifications: runtimeNotifications.list(),
      isArchived: (path) => archivedPaths.has(normalizeArchivePath(path)),
      findLinearIssue: (branch) => {
        const match = linearIssues.find((issue) => branchMatchesIssue(branch, issue.branchName))
        return match
          ? {
              identifier: match.identifier,
              url: match.url,
              state: match.state,
            }
          : null
      },
      findAgentLabel: (agentId) => {
        if (!agentId) return null
        return getAgentDefinition(config, agentId)?.label ?? agentId
      },
    })
    // Existing worktrees may have been created by an older Taskflow version, a
    // CLI-only flow, or before an environment provider was configured.  Give
    // each managed worktree a persisted *detected* environment before mapping
    // the snapshot so the dashboard always has a lifecycle surface.  This does
    // not start containers; opening a worktree or pressing Start owns that
    // transition.
    const existingEnvironments = projectEnvironments()
    await Promise.all(
      snapshot.worktrees.map(async (worktree): Promise<void> => {
        const runtimeState = projectRuntime.getWorktreeByBranch(worktree.branch)
        if (!runtimeState) return
        if (environmentIdForWorkspace(existingEnvironments, runtimeState.worktreeId)) return
        const prepared = await prepareWorkspaceEnvironment({
          workspacePath: runtimeState.path,
          workspaceId: runtimeState.worktreeId,
          profileName: worktree.profile,
          start: false,
        })
        if (!prepared.ok) {
          log.debug(
            `[environment:detect] branch=${worktree.branch} status=${prepared.reason} ${prepared.diagnostics.join('; ')}`,
          )
        }
      }),
    )
    const environments = projectEnvironments()
    return {
      ...snapshot,
      worktrees: snapshot.worktrees.map((worktree) => {
        const runtimeState = projectRuntime.getWorktreeByBranch(worktree.branch)
        return {
          ...worktree,
          environmentId: runtimeState ? environmentIdForWorkspace(environments, runtimeState.worktreeId) : null,
        }
      }),
    }
  }

  // --- API handler functions (thin I/O layer, testable by injecting deps) ---

  function findSnapshotWorktree(snapshot: ProjectSnapshot, branch: string): WorktreeSnapshot | null {
    return snapshot.worktrees.find((worktree) => worktree.branch === branch) ?? null
  }

  async function resolveAgentsWorktree(branch: string): Promise<
    | {
        ok: true
        worktree: WorktreeSnapshot
      }
    | {
        ok: false
        response: Response
      }
  > {
    const snapshot = await readProjectSnapshot()
    const worktree = findSnapshotWorktree(snapshot, branch)
    if (!worktree) {
      return {
        ok: false,
        response: errorResponse(`Worktree not found: ${branch}`, 404),
      }
    }

    return {
      ok: true,
      worktree,
    }
  }

  function resolveWorktreeAgentChatSupport(worktree: WorktreeSnapshot, action: 'chat' | 'interrupt') {
    return resolveAgentChatSupport({
      agentId: worktree.agentName,
      agentLabel: worktree.agentLabel,
      agent: worktree.agentName ? getAgentDefinition(config, worktree.agentName) : null,
      action,
    })
  }

  function resolveWorktreeTerminalSubmitDelayMs(agentName: WorktreeSnapshot['agentName']): number {
    return resolveAgentTerminalSubmitDelayMs({
      agentId: agentName,
      agent: agentName ? getAgentDefinition(config, agentName) : null,
    })
  }

  function withClaudeLiveConversation(
    response: AgentsUiWorktreeConversationResponse,
  ): AgentsUiWorktreeConversationResponse {
    if (response.conversation.provider !== 'claudeCode') return response

    const activeTurnId = claudeConversationStreamService.activeTurnId(response.conversation.conversationId)
    if (!activeTurnId) return response

    return {
      ...response,
      conversation: {
        ...response.conversation,
        running: true,
        activeTurnId,
      },
    }
  }

  async function setAgentTerminalStale(worktree: WorktreeSnapshot, stale: boolean): Promise<void> {
    const gitDir = git.resolveWorktreeGitDir(worktree.path)
    const meta = await readWorktreeMeta(gitDir)
    if (!meta) return

    await writeWorktreeMeta(gitDir, {
      ...meta,
      agentTerminalStale: stale,
    })
    if (projectRuntime.getWorktree(meta.worktreeId)) {
      projectRuntime.setAgentTerminalStale(meta.worktreeId, stale)
    }
  }

  /** Drive the worktree agent lifecycle from the backend-owned `claude -p` web
   *  chat run. The hook-based lifecycle (UserPromptSubmit/Stop) is best-effort and
   *  can be lost or reordered, leaving the worktree stuck "running" so the busy
   *  gate blocks the next web message even though nothing is running. The owned
   *  run's start/settle is authoritative, so we set it directly. */
  function setBranchAgentLifecycle(branch: string, lifecycle: 'running' | 'stopped'): void {
    const state = projectRuntime.getWorktreeByBranch(branch)
    if (!state) return
    projectRuntime.applyEvent({
      type: 'agent_status_changed',
      worktreeId: state.worktreeId,
      branch: state.branch,
      lifecycle,
    })
  }

  function setWorktreeAgentLifecycle(worktree: WorktreeSnapshot, lifecycle: 'running' | 'stopped'): void {
    setBranchAgentLifecycle(worktree.branch, lifecycle)
  }

  async function resolveClaudeStreamingLaunchContext(worktree: WorktreeSnapshot): Promise<
    | {
        ok: true
        data: ClaudeStreamingLaunchContext | null
      }
    | {
        ok: false
        response: Response
      }
  > {
    const gitDir = git.resolveWorktreeGitDir(worktree.path)
    const meta = await readWorktreeMeta(gitDir)
    if (!meta) {
      return {
        ok: false,
        response: errorResponse('Worktree metadata is missing', 409),
      }
    }

    const profile = config.profiles[meta.profile]
    if (!profile) {
      return {
        ok: false,
        response: errorResponse(`Profile is missing for Claude web chat: ${meta.profile}`, 409),
      }
    }

    return {
      ok: true,
      data: await buildClaudeStreamingLaunchContext({
        meta,
        profile,
        worktreePath: worktree.path,
      }),
    }
  }

  function isBusyAgentStatus(status: string): boolean {
    return status === 'starting' || status === 'running'
  }

  async function sendClaudeStreamingMessage(input: {
    worktree: WorktreeSnapshot
    text: string
    conversationId: string
  }): Promise<Response | null> {
    const launchContext = await resolveClaudeStreamingLaunchContext(input.worktree)
    if (!launchContext.ok) return launchContext.response
    if (!launchContext.data) return null

    if (isBusyAgentStatus(input.worktree.status)) {
      return errorResponse(
        'Claude is already running in the terminal. Wait for it to finish before sending a web chat message.',
        409,
      )
    }

    const hasExistingSession = !isPendingClaudeConversationId(input.conversationId)
    const sessionId = hasExistingSession ? input.conversationId : randomUUID()
    if (!hasExistingSession) {
      const saved = await claudeConversationService.setWorktreeConversationSession(input.worktree, sessionId)
      if (!saved.ok) {
        return errorResponse(saved.error, saved.status)
      }
    }

    // TODO: a tool-call-ending turn can still re-stick "running" if the subprocess's async PostToolUse hook lands after this onRunSettled; fully fix by suppressing status hooks for owned runs.
    const turnId = `claude-turn:${randomUUID()}`
    const started = claudeConversationStreamService.startRun({
      conversationId: sessionId,
      turnId,
      cwd: input.worktree.path,
      prompt: input.text,
      env: launchContext.data.env,
      permissionMode: launchContext.data.permissionMode,
      ...(hasExistingSession ? { resumeSessionId: sessionId } : { sessionId }),
      ...(!hasExistingSession && launchContext.data.systemPrompt
        ? { systemPrompt: launchContext.data.systemPrompt }
        : {}),
      onRunSettled: () => setWorktreeAgentLifecycle(input.worktree, 'stopped'),
    })
    if (!started.ok) {
      return errorResponse(started.error, 409)
    }

    setWorktreeAgentLifecycle(input.worktree, 'running')
    await setAgentTerminalStale(input.worktree, true)
    return jsonResponse({
      conversationId: sessionId,
      turnId,
      running: true,
      streaming: true,
    })
  }

  async function setLinearAutoCreateEnabled(enabled: boolean): Promise<boolean> {
    linearAutoCreateEnabled = enabled
    if (linearAutoCreateEnabled) {
      resetProcessedIssues()
      startLinearAutoCreate()
      log.info('[config] Linear auto-create worktrees enabled')
    } else {
      stopLinearAutoCreateMonitor()
      log.info('[config] Linear auto-create worktrees disabled')
    }

    await persistLocalLinearConfig(PROJECT_DIR, { autoCreateWorktrees: linearAutoCreateEnabled })
    return linearAutoCreateEnabled
  }

  async function setAutoRemoveOnMergeEnabled(enabled: boolean): Promise<boolean> {
    autoRemoveOnMergeEnabled = enabled
    log.info(`[config] Auto-remove on merge ${autoRemoveOnMergeEnabled ? 'enabled' : 'disabled'}`)

    await persistLocalGitHubConfig(PROJECT_DIR, { autoRemoveOnMerge: autoRemoveOnMergeEnabled })
    return autoRemoveOnMergeEnabled
  }

  /** Shared between the HTTP handler and the server-side oneshot watcher. Resolves
   *  the worktree's conversation and exports it via `exportConversationToLinear`. */
  async function postWorktreeConversationToLinear(
    branch: string,
    target: PostWorktreeToLinearTarget,
  ): Promise<WorktreePostToLinearOutcome> {
    if (!config.integrations.linear.enabled) {
      return { ok: false, error: 'Linear integration is disabled', status: 400 }
    }
    const apiKey = process.env.LINEAR_API_KEY
    if (!apiKey?.trim()) {
      return { ok: false, error: 'LINEAR_API_KEY not set', status: 503 }
    }

    await reconciliationService.reconcile(PROJECT_DIR)
    const state = projectRuntime.getWorktreeByBranch(branch)
    if (!state) return { ok: false, error: `Worktree not found: ${branch}`, status: 404 }

    const resolved = await resolveAgentsWorktree(branch)
    if (!resolved.ok) {
      return { ok: false, error: `Worktree not found: ${branch}`, status: 404 }
    }

    const chatSupport = resolveWorktreeAgentChatSupport(resolved.worktree, 'chat')
    if (!chatSupport.ok) return { ok: false, error: chatSupport.error, status: chatSupport.status }

    const conversationResult =
      chatSupport.data.provider === 'claude'
        ? await claudeConversationService.readWorktreeConversation(resolved.worktree)
        : await worktreeConversationService.readWorktreeConversation(resolved.worktree)
    if (!conversationResult.ok) return { ok: false, error: conversationResult.error, status: conversationResult.status }

    const prUrl = (state.prs ?? []).find((pr) => pr.state === 'open' || pr.state === 'merged')?.url ?? null

    const exportInput: ExportConversationInput = {
      target,
      branch,
      baseBranch: state.baseBranch ?? null,
      agent: resolved.worktree.agentName ?? null,
      prUrl,
      conversation: conversationResult.data.conversation,
      taskflowVersion: PORTTA_FLOW_VERSION,
    }
    const deps: ExportConversationDependencies = {
      fetchIssueWithAttachments,
      fetchTeamByKey,
      createLinearIssue,
      uploadAttachmentFile,
      attachToIssue,
      createIssueComment,
    }
    const result = await exportConversationToLinear(exportInput, deps)
    if (!result.ok) return { ok: false, error: result.error, status: result.status }
    return { ok: true, data: result.data }
  }

  // --- Server ---

  // Light-tier loops run for every known project (Run state, PR/CI poll,
  // Linear auto-create, oneshot watcher, auto-pull). Worktree reconciliation
  // and terminal attach remain on-demand.
  function startLight(): void {
    stopRunReconciliation = startSerializedInterval(async () => {
      await Promise.all([
        runService.reconcileProject(instancePrefix, PROJECT_DIR).catch((error: unknown): void => {
          log.error(`[runs] reconciliation failed for ${instancePrefix}: ${String(error)}`)
        }),
        reconcileProjectEnvironments().catch((error: unknown): void => {
          log.error(`[environments] reconciliation failed for ${instancePrefix}: ${String(error)}`)
        }),
      ])
    }, 2_000)
    // Display sync (PR/CI status shown in the dashboard) stays gated on dashboard
    // activity -- that data is only needed while someone is looking.
    stopPrMonitor = startPrMonitor(
      getWorktreeGitDirs,
      config.integrations.github.linkedRepos,
      PROJECT_DIR,
      undefined,
      hasRecentDashboardActivity,
    )
    // Auto-remove is headless maintenance: it must run even when the dashboard is
    // closed, so it gets its own ungated sweep instead of riding the display sync.
    stopAutoRemoveMonitor = startAutoRemoveMonitor(async () => {
      if (autoRemoveOnMergeEnabled) {
        await runAutoRemove(autoRemoveDeps)
      }
    })
    if (linearAutoCreateEnabled) {
      startLinearAutoCreate()
    }
    stopOneshotWatcher = startOneshotWatcher({
      projectRuntime,
      lifecycleService,
      postToLinear: async (branch, target) => {
        const outcome = await postWorktreeConversationToLinear(branch, target)
        if (!outcome.ok) throw new Error(outcome.error)
      },
    })
    if (config.workspace.autoPull.enabled) {
      stopAutoPullMonitor = startAutoPullMonitor(
        { git, projectRoot: PROJECT_DIR, mainBranch: config.workspace.mainBranch },
        config.workspace.autoPull.intervalSeconds * 1000,
      )
    }
    stopSessionSnapshot = startSessionSnapshotMonitor({ git, sessions, projectRoot: PROJECT_DIR })
  }

  function stopLight(): void {
    stopPrMonitor?.()
    stopPrMonitor = null
    stopAutoRemoveMonitor?.()
    stopAutoRemoveMonitor = null
    stopLinearAutoCreateMonitor()
    stopOneshotWatcher?.()
    stopOneshotWatcher = null
    stopAutoPullMonitor?.()
    stopAutoPullMonitor = null
    stopSessionSnapshot?.()
    stopSessionSnapshot = null
    stopRunReconciliation?.()
    stopRunReconciliation = null
    void environments.close()
  }

  const shutdownRuns = (): Promise<void> => runService.shutdownProject(instancePrefix, PROJECT_DIR)

  return {
    prefix: instancePrefix,
    frontendConfig: getFrontendConfig,
    diagnostics: environmentDiagnostics,
    environments,
    runtime,
    readProjectSnapshot,
    worktreeConversationService,
    claudeConversationService,
    claudeConversationStreamService,
    resolveAgentsWorktree,
    resolveWorktreeAgentChatSupport,
    withClaudeLiveConversation,
    setAgentTerminalStale,
    sendClaudeStreamingMessage,
    resolveAgentsTerminalWorktree,
    disarmOneshotIfArmed,
    port: PORT,
    ensureBranchNotBusy,
    withRemovingBranch,
    withMutatingTab,
    setBranchAgentLifecycle,
    resolveTerminalWorktree,
    resolveWorktreeTerminalSubmitDelayMs,
    processRunner: host.processRunner,
    setLinearAutoCreateEnabled,
    setAutoRemoveOnMergeEnabled,
    postWorktreeConversationToLinear,
    getWorktreeGitDirs,
    runs: {
      service: runService,
      presentation: runPresentation,
      transcripts: executionTranscripts,
      workflowCatalog,
      store: runStore,
      dataRoot: workflowDataRoot,
      subscribe: (listener) => {
        runEventListeners.add(listener)
        return () => runEventListeners.delete(listener)
      },
    },
    codexAppServerClient,
    startLight,
    stopLight,
    shutdownRuns,
  }
}
