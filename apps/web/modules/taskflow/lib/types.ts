import type {
  AgentId,
  LinkedLinearIssue,
  OneshotConfig,
  PrEntry,
  RunEvent,
  ServiceStatus,
  WorkflowDefinition,
  WorktreeCreationPhase,
  WorktreeSource,
  WorktreeTab,
} from 'portta-contracts/taskflow'

export type {
  AgentDetails,
  AgentId,
  AgentPermissionMode,
  AgentResponse,
  AgentSummary,
  AgentsSendMessageRequest as AgentsUiSendMessageRequest,
  AgentsUiConversationEvent,
  AgentsUiConversationMessage,
  AgentsUiConversationMessageDeltaEvent,
  AgentsUiConversationMessageUpsertEvent,
  AgentsUiConversationState,
  AgentsUiConversationStatusEvent,
  AgentsUiInterruptResponse,
  AgentsUiSendMessageResponse,
  AgentsUiWorktreeConversationResponse,
  AgentTransport,
  AppConfig,
  AppNotification,
  AutoNameConfigResponse,
  AvailableBranch,
  BuiltInAgentId,
  CreateRunRequest,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
  DiagnosticsResponse,
  Environment,
  EnvironmentExecRequest,
  EnvironmentExecResponse,
  EnvironmentResponse,
  EnvironmentService,
  EnvironmentServiceActionRequest,
  EnvironmentServicesResponse,
  ExecutionTranscriptResponse,
  LinearIssue,
  LinearIssueAvailability,
  LinearIssuesResponse,
  LinkedLinearIssue,
  LinkedRepoInfo,
  OkResponse,
  OneshotConfig,
  OpenWorktreeRequest,
  PostWorktreeToLinearResponse,
  PostWorktreeToLinearTarget,
  PrComment,
  PrEntry,
  ProfileConfig,
  ProjectInitPhase,
  ProjectInitState,
  ProjectSnapshot,
  ProjectSummary,
  ProjectWorktreeSnapshot,
  PullMainRequest,
  PullMainResult,
  RunDetailResponse,
  RunEvent,
  RunEventsResponse,
  RunListResponse,
  RunWorkspaceContext,
  ServiceStatus,
  TranscriptEntry,
  UnpushedCommit,
  UpsertCustomAgentRequest,
  ValidateCustomAgentResponse,
  WorkflowDefinition,
  WorkflowListResponse,
  WorkflowWorkspacePolicy,
  WorkspaceStrategy,
  WorktreeCreateMode,
  WorktreeCreationPhase,
  WorktreeSource,
  WorktreeTab,
} from 'portta-contracts/taskflow'

export interface WorkflowCatalogGroup {
  origin: WorkflowDefinition['origin']
  workflows: WorkflowDefinition[]
}

export interface FileUploadResult {
  files: Array<{ path: string }>
}

export interface RunTimelineState {
  events: RunEvent[]
  cursor: number | null
}

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  question: string
  header: string
  multiSelect?: boolean
  options: AskUserQuestionOption[]
}

export interface AskUserQuestionInput {
  questions: AskUserQuestionItem[]
}

export interface DiffDialogProps {
  branch: string
  cursorUrl?: string | null
  onClose: () => void
}

/** What `/api/worktrees/:name/terminal-launch` answers: the command that attaches a local terminal. */
export interface NativeTerminalLaunch {
  worktreeId: string
  branch: string
  path: string
  shellCommand: string
}

export interface WorktreeInfo {
  branch: string
  label: string | null
  baseBranch?: string
  archived: boolean
  agent: string
  mux: string
  path: string
  dir: string | null
  dirty: boolean
  unpushed: boolean
  status: string
  elapsed: string
  profile: string | null
  agentName: AgentId | null
  interfaceMode?: 'terminal' | 'web_chat'
  agentLabel: string | null
  agentTerminalStale: boolean
  services: ServiceStatus[]
  paneCount: number
  prs: PrEntry[]
  linearIssue: LinkedLinearIssue | null
  creating: boolean
  creationPhase: WorktreeCreationPhase | null
  source: WorktreeSource
  oneshot: OneshotConfig | null
  tabs: WorktreeTab[]
  activeTabId: string | null
  environmentId?: string | null
}

export interface WorktreeListRow {
  worktree: WorktreeInfo
  depth: number
}

export type ToastTone = 'info' | 'success' | 'error'

/** An agent notification the server pushed, as it sits in the toast stack. */
export interface ToastItem {
  id: string
  source: 'notification'
  notificationId: number
  branch: string
  tone: ToastTone
  message: string
  detail?: string
}
