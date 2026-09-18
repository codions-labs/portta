import { type JsonValue, WORKSPACE_ACCESSES, WORKSPACE_STRATEGIES } from 'portta-core/taskflow'
import { z } from 'zod'
import { IssueRef } from '../work-types.ts'

const BooleanLikeSchema = z.union([
  z.boolean(),
  z.literal('true').transform(() => true),
  z.literal('false').transform(() => false),
])

export const ErrorResponseSchema = z.object({
  error: z.string(),
})

export const OkResponseSchema = z.object({
  ok: z.literal(true),
})

export const EnabledResponseSchema = z.object({
  ok: z.literal(true),
  enabled: z.boolean(),
})

export const DiagnosticCheckStatusSchema = z.enum(['ok', 'warning', 'error', 'skipped'])

export const DiagnosticCheckSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  status: DiagnosticCheckStatusSchema,
  required: z.boolean(),
  summary: z.string().trim().min(1),
  remediation: z.string().trim().min(1).nullable(),
})

export const DiagnosticsResponseSchema = z.object({
  ready: z.boolean(),
  checkedAt: z.iso.datetime({ offset: true }),
  checks: z.array(DiagnosticCheckSchema),
})

export type { JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

const TimestampSchema = z.iso.datetime({ offset: true })
const PublicIdSchema = z.string().trim().min(1)
const ConfigurationValueSchema = z.string().trim().min(1)
const SequenceSchema = z.number().int().nonnegative()
const SequenceQuerySchema = z.union([
  SequenceSchema,
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value)),
])

export const RunIdSchema = PublicIdSchema
export const ExecutionIdSchema = PublicIdSchema
export const SessionIdSchema = PublicIdSchema
export const WorkspaceIdSchema = PublicIdSchema
export const WorkflowIdSchema = PublicIdSchema
export const ProjectIdSchema = PublicIdSchema
export const IdempotencyKeySchema = z.string().trim().min(1).max(255)
export const RunModeSchema = z.enum(['workflow', 'direct'])
export const RunStatusSchema = z.enum([
  'queued',
  'provisioning',
  'running',
  'waiting_input',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])
export const ExecutionStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'skipped', 'cancelled'])
export const AgentTransportSchema = z.enum(['native', 'acp'])
export const AgentPermissionModeSchema = z.enum(['interactive', 'workspace', 'deny'])
export const StdioMcpServerSchema = z
  .object({
    name: z.string().trim().min(1),
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()
export const WorkspacePolicySchema = z.enum(['none', 'run'])
export const WorkspaceStrategySchema = z.enum(WORKSPACE_STRATEGIES)
export const WorkspaceAccessSchema = z.enum(WORKSPACE_ACCESSES)
export const WorkspaceStateSchema = z.enum(['provisioning', 'ready', 'preserved', 'removed'])
export const WorkflowOriginSchema = z.enum(['builtin', 'global', 'project'])
export const WorkflowAvailabilitySchema = z.enum(['available', 'unavailable'])
export const EventSourceSchema = z.enum(['run', 'workflow', 'harness', 'session', 'system'])

export const SessionCapabilitySchema = z
  .object({
    terminal: z.boolean(),
    interactiveInput: z.boolean(),
    interrupt: z.boolean(),
    resume: z.boolean(),
  })
  .strict()

export const RunCapabilitySchema = z
  .object({
    cancel: z.boolean(),
    resume: z.boolean(),
  })
  .strict()

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  strategy: WorkspaceStrategySchema.default('isolated_worktree'),
  path: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  baseBranch: z.string().min(1).nullable(),
  baseCommit: z.string().min(1).nullable(),
  state: WorkspaceStateSchema,
})

export const WorkspaceSelectionSchema = z.discriminatedUnion('strategy', [
  z
    .object({
      strategy: z.literal('isolated_worktree'),
      branch: z.string().trim().min(1).optional(),
      baseBranch: z.string().trim().min(1).optional(),
      existingBranch: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      strategy: z.literal('new_branch'),
      branch: z.string().trim().min(1).optional(),
      baseBranch: z.string().trim().min(1).optional(),
    })
    .strict(),
  z.object({ strategy: z.literal('current_branch') }).strict(),
])

export const WorkflowWorkspacePolicySchema = z
  .object({
    default: WorkspaceStrategySchema,
    allowed: z.array(WorkspaceStrategySchema).min(1),
    mutatesRepository: z.boolean(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict()

export const WorkflowPhaseSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  detail: z.string().trim().min(1).nullable().optional(),
})

export const WorkflowDefinitionSchema = z.object({
  id: WorkflowIdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  origin: WorkflowOriginSchema,
  path: z.string().min(1),
  contentHash: z.string().trim().min(1),
  phases: z.array(WorkflowPhaseSchema),
  availability: WorkflowAvailabilitySchema,
  diagnostics: z.array(z.string()),
  whenToUse: z.string().trim().min(1).nullable().optional(),
  defaultProvider: ConfigurationValueSchema.nullable().optional(),
  defaultModel: ConfigurationValueSchema.nullable().optional(),
  defaultSandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).nullable().optional(),
  workspace: WorkflowWorkspacePolicySchema.default({
    default: 'isolated_worktree',
    allowed: ['isolated_worktree', 'new_branch', 'current_branch'],
    mutatesRepository: true,
  }),
})

export const WorkflowSnapshotSchema = z.object({
  id: PublicIdSchema,
  workflowId: WorkflowIdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  origin: WorkflowOriginSchema,
  path: z.string().min(1),
  contentHash: z.string().trim().min(1),
  engineVersion: z.string().trim().min(1),
  createdAt: TimestampSchema,
})

export const ExecutionUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
})

export const ExecutionObservabilitySchema = z
  .object({
    index: z.number().int().nonnegative().nullable(),
    phaseIndex: z.number().int().nonnegative().nullable(),
    cached: z.boolean(),
    lastTool: z.string().nullable(),
    promptPreview: z.string().nullable(),
    resultPreview: z.string().nullable(),
    worktreeBranch: z.string().nullable(),
    worktreePath: z.string().nullable(),
    transcript: z.boolean(),
  })
  .strict()

export const ExecutionSchema = z.object({
  id: ExecutionIdSchema,
  runId: RunIdSchema,
  nodeKey: z.string().trim().min(1),
  label: z.string().trim().min(1),
  phase: z.string().trim().min(1).nullable(),
  attempt: z.number().int().positive(),
  harness: ConfigurationValueSchema,
  provider: ConfigurationValueSchema.nullable(),
  model: ConfigurationValueSchema.nullable(),
  transport: AgentTransportSchema.optional(),
  effectiveConfig: JsonValueSchema,
  workspaceId: WorkspaceIdSchema.nullable(),
  input: JsonValueSchema.nullable(),
  output: JsonValueSchema.nullable(),
  status: ExecutionStatusSchema,
  usage: ExecutionUsageSchema,
  error: z.string().nullable(),
  sessionId: SessionIdSchema.nullable(),
  capabilities: SessionCapabilitySchema.nullable(),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  observability: ExecutionObservabilitySchema.nullable().optional(),
})

export const RunSchema = z.object({
  id: RunIdSchema,
  projectId: ProjectIdSchema,
  mode: RunModeSchema,
  input: JsonValueSchema,
  status: RunStatusSchema,
  workspacePolicy: WorkspacePolicySchema,
  workspaceStrategy: WorkspaceStrategySchema.default('isolated_worktree'),
  workflowSnapshot: WorkflowSnapshotSchema.nullable(),
  harness: ConfigurationValueSchema.nullable().optional(),
  workspace: WorkspaceSchema.nullable(),
  environmentId: z.string().nullable().optional(),
  profile: z.string().trim().min(1).nullable(),
  error: z.string().nullable(),
  capabilities: RunCapabilitySchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  issueRef: IssueRef.nullable().optional(),
})

export const WorkflowProgressPhaseStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'skipped',
])

export const WorkflowProgressPhaseSchema = z
  .object({
    index: z.number().int().nonnegative(),
    title: z.string().trim().min(1),
    pending: z.boolean(),
    status: WorkflowProgressPhaseStatusSchema,
    executionIds: z.array(ExecutionIdSchema),
  })
  .strict()

export const WorkflowProgressSchema = z
  .object({
    phases: z.array(WorkflowProgressPhaseSchema),
    ungroupedExecutionIds: z.array(ExecutionIdSchema),
  })
  .strict()

export const RunArtifactSchema = z
  .object({
    kind: z.enum(['result', 'transcript', 'workspace']),
    label: z.string().trim().min(1),
    executionId: ExecutionIdSchema.nullable(),
    mimeType: z.string().trim().min(1).nullable(),
    size: z.number().int().nonnegative().nullable(),
  })
  .strict()

export const RunDetailSchema = RunSchema.extend({
  executions: z.array(ExecutionSchema),
  result: JsonValueSchema.nullable(),
  workflowProgress: WorkflowProgressSchema.nullable(),
  artifacts: z.array(RunArtifactSchema),
})

export const TranscriptChunkSchema = z.discriminatedUnion('kind', [
  z
    .object({
      t: z.number(),
      kind: z.literal('meta'),
      index: z.number().int().nonnegative(),
      label: z.string(),
      provider: z.string(),
      model: z.string().optional(),
      prompt: z.string(),
    })
    .strict(),
  z.object({ t: z.number(), kind: z.literal('text'), text: z.string() }).strict(),
  z.object({ t: z.number(), kind: z.literal('reasoning'), text: z.string() }).strict(),
  z
    .object({
      t: z.number(),
      kind: z.literal('tool'),
      id: z.string().optional(),
      name: z.string(),
      input: JsonValueSchema.optional(),
    })
    .strict(),
  z
    .object({
      t: z.number(),
      kind: z.literal('tool-result'),
      id: z.string().optional(),
      name: z.string().optional(),
      output: z.string().optional(),
      isError: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      t: z.number(),
      kind: z.literal('status'),
      state: z.enum(['running', 'done', 'failed']),
      error: z.string().optional(),
      cached: z.boolean().optional(),
    })
    .strict(),
])

export const TranscriptEntrySchema = z
  .object({
    cursor: SequenceSchema,
    chunk: TranscriptChunkSchema,
  })
  .strict()

export const ExecutionTranscriptResponseSchema = z
  .object({
    executionId: ExecutionIdSchema,
    entries: z.array(TranscriptEntrySchema),
    nextCursor: SequenceSchema,
  })
  .strict()

const CreateRunFields = {
  input: JsonValueSchema,
  workspacePolicy: WorkspacePolicySchema.optional(),
  workspace: WorkspaceSelectionSchema.optional(),
  profile: z.string().trim().min(1).optional(),
  idempotencyKey: IdempotencyKeySchema,
  transport: AgentTransportSchema.optional(),
  permissionMode: AgentPermissionModeSchema.optional(),
  mcpServers: z.array(StdioMcpServerSchema).optional(),
  /** The issue this Run is for, when one started it. A ref, never a copy. */
  issueRef: IssueRef.optional(),
}

export const CreateRunRequestSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('workflow'),
      workflowId: WorkflowIdSchema,
      ...CreateRunFields,
      permissionMode: z.enum(['workspace', 'deny']).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('direct'),
      harness: ConfigurationValueSchema,
      provider: ConfigurationValueSchema.optional(),
      model: ConfigurationValueSchema.optional(),
      ...CreateRunFields,
    })
    .strict(),
])

export const CancelRunRequestSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict()

export const ResumeRunRequestSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict()

export const RespondRunPermissionRequestSchema = z
  .object({
    requestId: z.uuid(),
    optionId: z.string().trim().min(1).nullable(),
  })
  .strict()

export const RunEventPayloadSchema = z.object({
  version: z.literal(1),
  data: JsonValueSchema,
})

export const RunEventSchema = z.object({
  id: PublicIdSchema,
  runId: RunIdSchema,
  executionId: ExecutionIdSchema.nullable(),
  sessionId: SessionIdSchema.nullable(),
  sequence: SequenceSchema,
  type: z.string().trim().min(1),
  timestamp: TimestampSchema,
  source: EventSourceSchema,
  payload: RunEventPayloadSchema,
})

export const ProjectIdParamsSchema = z.object({
  projectId: ProjectIdSchema,
})

export const TaskflowRunIdParamsSchema = z.object({
  runId: RunIdSchema,
})

export const ExecutionIdParamsSchema = z.object({
  executionId: ExecutionIdSchema,
})

export const RunEventsQuerySchema = z.object({
  after: SequenceQuerySchema.optional(),
})

export const ExecutionTranscriptQuerySchema = z.object({
  after: SequenceQuerySchema.optional(),
})

export const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowDefinitionSchema),
})

export const RunWorkspaceContextSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1).nullable(),
  headCommit: z.string().min(1).nullable(),
  dirty: z.boolean(),
  activeReaders: z.number().int().nonnegative(),
  activeWriterRunId: RunIdSchema.nullable(),
})

export const RunListResponseSchema = z.object({
  runs: z.array(RunSchema),
})

export const RunDetailResponseSchema = z.object({
  run: RunDetailSchema,
})

export const RunEventsResponseSchema = z
  .object({
    events: z.array(RunEventSchema),
    nextCursor: SequenceSchema.nullable(),
  })
  .superRefine((value, context) => {
    for (let index = 1; index < value.events.length; index += 1) {
      const current = value.events[index]
      const previous = value.events[index - 1]
      if (current && previous && current.sequence <= previous.sequence) {
        context.addIssue({
          code: 'custom',
          message: 'Events must be ordered by increasing sequence',
          path: ['events', index, 'sequence'],
        })
      }
    }

    const lastEvent = value.events.at(-1)
    if (lastEvent && value.nextCursor !== null && value.nextCursor < lastEvent.sequence) {
      context.addIssue({
        code: 'custom',
        message: 'nextCursor must not precede the last event',
        path: ['nextCursor'],
      })
    }
  })

export const BuiltInAgentIdSchema = z.enum(['claude', 'codex'])
export const AgentIdSchema = z.string().trim().min(1)
export const AgentKindSchema = BuiltInAgentIdSchema
export const WorktreeCreateModeSchema = z.enum(['new', 'existing'])

export const LinearIssueIdSchema = z.string().regex(/^[A-Z]+-\d+$/, 'Expected Linear issue id (e.g. ENG-123)')
export const LinearTeamKeySchema = z.string().regex(/^[A-Z]+$/, 'Expected Linear team key (e.g. ENG)')

/** Distinguishes a Linear issue id (TEAM-123) from a team key (TEAM). */
export type LinearTarget =
  | { kind: 'issue'; issueId: string }
  | { kind: 'team'; teamKey: string }
  | { kind: 'invalid'; raw: string }

export function parseLinearTarget(raw: string): LinearTarget {
  const trimmed = raw.trim()
  if (LinearIssueIdSchema.safeParse(trimmed).success) return { kind: 'issue', issueId: trimmed }
  if (LinearTeamKeySchema.safeParse(trimmed).success) return { kind: 'team', teamKey: trimmed }
  return { kind: 'invalid', raw: trimmed }
}

export const PostWorktreeToLinearTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('issue'), issueId: LinearIssueIdSchema }),
  z.object({ kind: z.literal('team'), teamKey: LinearTeamKeySchema, title: z.string().trim().min(1).optional() }),
])

export const PostWorktreeToLinearRequestSchema = z.object({
  target: PostWorktreeToLinearTargetSchema,
})

export const PostWorktreeToLinearResponseSchema = z.object({
  ok: z.literal(true),
  issueId: z.string(),
  issueUrl: z.string(),
  commentUrl: z.string().nullable(),
  attachmentUrl: z.string(),
})

export const FromLinearInputSchema = z.object({
  issueId: LinearIssueIdSchema,
  conversationContext: z.string().optional(),
})

/** Oneshot watch config carried on create/open requests. When present, the server-side
 *  oneshot watcher will auto-close the session (and optionally post to Linear) once the
 *  agent finishes. Any browser-originated interaction with the session disarms the watcher. */
export const OneshotConfigSchema = z.object({
  autoCloseOnDone: z.boolean().optional(),
  postToLinearOnDone: PostWorktreeToLinearTargetSchema.optional(),
})

export const AgentCapabilitiesSchema = z.object({
  terminal: z.literal(true),
  inAppChat: z.boolean(),
  conversationHistory: z.boolean(),
  interrupt: z.boolean(),
  resume: z.boolean(),
})

export const AgentSummarySchema = z.object({
  id: AgentIdSchema,
  label: z.string(),
  kind: z.enum(['builtin', 'custom']),
  capabilities: AgentCapabilitiesSchema,
})

export const AgentDetailsSchema = z.object({
  id: AgentIdSchema,
  label: z.string(),
  kind: z.enum(['builtin', 'custom']),
  capabilities: AgentCapabilitiesSchema,
  startCommand: z.string().nullable(),
  resumeCommand: z.string().nullable(),
})

export const AgentListResponseSchema = z.object({
  agents: z.array(AgentDetailsSchema),
})

export const UpsertCustomAgentRequestSchema = z.object({
  label: z.string().trim().min(1),
  startCommand: z.string().trim().min(1),
  resumeCommand: z.string().trim().optional(),
})

export const AgentResponseSchema = z.object({
  agent: AgentDetailsSchema,
})

export const ValidateCustomAgentResponseSchema = z.object({
  normalizedId: AgentIdSchema,
  warnings: z.array(z.string()),
})
export const WorktreeCreationPhaseSchema = z.enum([
  'creating_worktree',
  'preparing_runtime',
  'running_post_create_hook',
  'starting_session',
  'reconciling',
])

export const AvailableBranchSchema = z.object({
  name: z.string(),
})

export const AvailableBranchesQuerySchema = z.object({
  includeRemote: BooleanLikeSchema.optional(),
})

/** Removing a worktree deletes its branch, so discarding work is asked for explicitly. */
export const RemoveWorktreeQuerySchema = z.object({
  force: BooleanLikeSchema.optional(),
})

const NumberLikePathParamSchema = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value)),
])

export const BranchListResponseSchema = z.object({
  branches: z.array(AvailableBranchSchema),
})

export const WorktreeSourceSchema = z.enum(['ui', 'oneshot'])
export const SessionInterfaceModeSchema = z.enum(['terminal', 'web_chat'])

export const CreateWorktreeRequestSchema = z.object({
  mode: WorktreeCreateModeSchema.optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  profile: z.string().optional(),
  agent: AgentIdSchema.optional(),
  agents: z.array(AgentIdSchema).min(1).optional(),
  prompt: z.string().optional(),
  envOverrides: z.record(z.string(), z.string()).optional(),
  createLinearTicket: z.literal(true).optional(),
  linearTitle: z.string().optional(),
  // Accept any case at the boundary, then normalize and validate against the
  // team-key shape. Invalid inputs (e.g. "ENG-1") get a clear 400 instead of
  // being forwarded to Linear for a vague 404.
  linearTeamKey: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(LinearTeamKeySchema)
    .optional(),
  fromLinear: FromLinearInputSchema.optional(),
  issueRef: IssueRef.optional(),
  source: WorktreeSourceSchema.optional(),
  oneshot: OneshotConfigSchema.optional(),
  interfaceMode: SessionInterfaceModeSchema.optional(),
})

export const OpenWorktreeRequestSchema = z.object({
  prompt: z.string().optional(),
  oneshot: OneshotConfigSchema.optional(),
  interfaceMode: SessionInterfaceModeSchema.optional(),
})

export const CreateWorktreeResponseSchema = z.object({
  primaryBranch: z.string(),
  branches: z.array(z.string()),
})

export const SetWorktreeArchivedRequestSchema = z.object({
  archived: z.boolean(),
})

export const SetWorktreeArchivedResponseSchema = z.object({
  ok: z.literal(true),
  archived: z.boolean(),
})

export const SetWorktreeLabelRequestSchema = z.object({
  label: z.string().trim().max(80).nullable(),
})

export const SetWorktreeLabelResponseSchema = z.object({
  ok: z.literal(true),
  label: z.string().nullable(),
})

export const SetWorktreeProfileRequestSchema = z.object({
  profile: z.string().trim().min(1),
})

export const SetWorktreeProfileResponseSchema = z.object({
  ok: z.literal(true),
  profile: z.string(),
  /** True when the tmux session was rebuilt with the new profile's panes.
   *  False when the worktree was closed — the new profile applies on next open. */
  restarted: z.boolean(),
})

export const ToggleEnabledRequestSchema = z.object({
  enabled: z.boolean(),
})

export const SendWorktreePromptRequestSchema = z.object({
  text: z.string().min(1),
  preamble: z.string().optional(),
})

export const AgentsSendMessageRequestSchema = z.object({
  text: z.string().trim().min(1),
})

export const PullMainRequestSchema = z.object({
  force: z.boolean().optional(),
  repo: z.string().optional(),
})

export const PullMainStatusSchema = z.enum(['updated', 'already_up_to_date', 'fetch_failed', 'merge_failed'])

export const PullMainResponseSchema = z.object({
  status: PullMainStatusSchema,
  from: z.string().optional(),
  to: z.string().optional(),
  error: z.string().optional(),
})

export const ServiceStatusSchema = z.object({
  name: z.string(),
  port: z.number().nullable(),
  running: z.boolean(),
  url: z.string().nullable().optional(),
})

export const PrCommentSchema = z.object({
  type: z.enum(['comment', 'inline']),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
  diffHunk: z.string().optional(),
  isReply: z.boolean().optional(),
})

export const CiCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'success', 'failed', 'skipped']),
  url: z.string().nullable(),
  runId: z.number().nullable(),
})

export const PrEntrySchema = z.object({
  repo: z.string(),
  number: z.number(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  url: z.string(),
  updatedAt: z.string(),
  ciStatus: z.enum(['none', 'pending', 'success', 'failed']),
  ciChecks: z.array(CiCheckSchema),
  comments: z.array(PrCommentSchema),
})

export const LinearIssueLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
})

export const LinearIssueStateSchema = z.object({
  name: z.string(),
  color: z.string(),
  type: z.string(),
})

export const LinkedLinearIssueSchema = z.object({
  identifier: z.string(),
  url: z.string(),
  state: LinearIssueStateSchema,
})

export const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  priorityLabel: z.string(),
  url: z.string(),
  branchName: z.string(),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
  state: LinearIssueStateSchema,
  team: z.object({
    name: z.string(),
    key: z.string(),
  }),
  labels: z.array(LinearIssueLabelSchema),
  project: z.string().nullable(),
})

export const LinearIssueAvailabilitySchema = z.enum(['disabled', 'missing_api_key', 'ready'])

export const LinearIssuesResponseSchema = z.object({
  availability: LinearIssueAvailabilitySchema,
  issues: z.array(LinearIssueSchema),
})

export const AutoNameProviderSchema = z.enum(['claude', 'codex'])

export const AutoNameConfigResponseSchema = z.object({
  autoName: z
    .object({
      provider: AutoNameProviderSchema,
      model: z.string().optional(),
      systemPrompt: z.string().optional(),
    })
    .nullable(),
  linearAvailability: LinearIssueAvailabilitySchema,
})

export const WorktreeCreationStateSchema = z.object({
  phase: WorktreeCreationPhaseSchema,
})

export const AppNotificationSchema = z.object({
  id: z.number(),
  branch: z.string(),
  type: z.enum(['agent_stopped', 'pr_opened', 'runtime_error', 'worktree_auto_removed']),
  message: z.string(),
  url: z.string().optional(),
  timestamp: z.number(),
})

export const WorktreeTabSchema = z.object({
  tabId: z.string(),
  kind: z.enum(['root', 'fork']),
  label: z.string(),
  seq: z.number().nullable(),
  sessionId: z.string().nullable(),
  paneId: z.string().optional(),
  createdAt: z.string(),
})

export const ProjectWorktreeSnapshotSchema = z.object({
  branch: z.string(),
  label: z.string().nullable(),
  baseBranch: z.string().optional(),
  path: z.string(),
  dir: z.string(),
  archived: z.boolean(),
  profile: z.string().nullable(),
  agentName: AgentIdSchema.nullable(),
  agentLabel: z.string().nullable(),
  agentTerminalStale: z.boolean(),
  mux: z.boolean(),
  dirty: z.boolean(),
  unpushed: z.boolean(),
  paneCount: z.number(),
  status: z.string(),
  elapsed: z.string(),
  services: z.array(ServiceStatusSchema),
  prs: z.array(PrEntrySchema),
  linearIssue: LinkedLinearIssueSchema.nullable(),
  issueRef: IssueRef.nullable().optional(),
  creation: WorktreeCreationStateSchema.nullable(),
  source: WorktreeSourceSchema,
  /** Present when the server-side oneshot watcher is armed for this worktree.
   *  Cleared by `disarmOneshot` on the first browser-originated interaction.
   *  CLI clients read this to detect "user took over" mid-run. */
  oneshot: OneshotConfigSchema.nullable(),
  /** Agent-pane tabs (`tabs[0]` is the root). Default keeps older servers valid. */
  tabs: z.array(WorktreeTabSchema).default([]),
  activeTabId: z.string().nullable().default(null),
  environmentId: z.string().nullable().optional(),
  interfaceMode: SessionInterfaceModeSchema.default('terminal'),
})

export const ProjectSnapshotSchema = z.object({
  project: z.object({
    name: z.string(),
    mainBranch: z.string(),
  }),
  worktrees: z.array(ProjectWorktreeSnapshotSchema),
  notifications: z.array(AppNotificationSchema),
})

export const WorktreeConversationProviderSchema = z.enum(['codexAppServer', 'claudeCode'])

export const CodexWorktreeConversationRefSchema = z.object({
  provider: z.literal('codexAppServer'),
  conversationId: z.string(),
  cwd: z.string(),
  lastSeenAt: z.string(),
  threadId: z.string(),
})

export const ClaudeWorktreeConversationRefSchema = z.object({
  provider: z.literal('claudeCode'),
  conversationId: z.string(),
  cwd: z.string(),
  lastSeenAt: z.string(),
  sessionId: z.string(),
})

export const WorktreeConversationRefSchema = z.discriminatedUnion('provider', [
  CodexWorktreeConversationRefSchema,
  ClaudeWorktreeConversationRefSchema,
])

export const AgentsUiWorktreeSummarySchema = z.object({
  branch: z.string(),
  baseBranch: z.string().optional(),
  path: z.string(),
  archived: z.boolean(),
  profile: z.string().nullable(),
  agentName: AgentIdSchema.nullable(),
  agentLabel: z.string().nullable(),
  agentTerminalStale: z.boolean(),
  mux: z.boolean(),
  status: z.string(),
  dirty: z.boolean(),
  unpushed: z.boolean(),
  services: z.array(ServiceStatusSchema),
  prs: z.array(PrEntrySchema),
  creating: z.boolean(),
  creationPhase: WorktreeCreationPhaseSchema.nullable(),
  conversation: WorktreeConversationRefSchema.nullable(),
})

export const AgentsUiConversationMessageRoleSchema = z.enum(['user', 'assistant'])
export const AgentsUiConversationMessageStatusSchema = z.enum(['completed', 'inProgress', 'failed'])
export const AgentsUiConversationMessageKindSchema = z.enum(['text', 'thinking', 'toolUse', 'toolResult'])

export const AgentsUiConversationMessageSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  order: z.number().int().nonnegative(),
  role: AgentsUiConversationMessageRoleSchema,
  text: z.string(),
  status: AgentsUiConversationMessageStatusSchema,
  createdAt: z.string().nullable(),
  kind: AgentsUiConversationMessageKindSchema,
  phase: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
})

export const AgentsUiConversationStateSchema = z.object({
  provider: WorktreeConversationProviderSchema,
  conversationId: z.string(),
  cwd: z.string(),
  running: z.boolean(),
  activeTurnId: z.string().nullable(),
  messages: z.array(AgentsUiConversationMessageSchema),
})

export const AgentsUiWorktreeConversationResponseSchema = z.object({
  worktree: AgentsUiWorktreeSummarySchema,
  conversation: AgentsUiConversationStateSchema,
})

export const AgentsUiSendMessageResponseSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  running: z.literal(true),
  streaming: z.boolean(),
})

export const AgentsUiInterruptResponseSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  interrupted: z.literal(true),
  streaming: z.boolean(),
})

export const AgentsUiConversationMessageDeltaEventSchema = z.object({
  type: z.literal('messageDelta'),
  revision: z.number().int().nonnegative(),
  conversationId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  order: z.number().int().nonnegative(),
  delta: z.string(),
})

export const AgentsUiConversationMessageUpsertEventSchema = z.object({
  type: z.literal('messageUpsert'),
  revision: z.number().int().nonnegative(),
  conversationId: z.string(),
  message: AgentsUiConversationMessageSchema,
})

export const AgentsUiConversationStatusEventSchema = z.object({
  type: z.literal('conversationStatus'),
  revision: z.number().int().nonnegative(),
  conversationId: z.string(),
  running: z.boolean(),
  activeTurnId: z.string().nullable(),
})

export const AgentsUiConversationErrorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
})

export const AgentsUiConversationEventSchema = z.discriminatedUnion('type', [
  AgentsUiConversationMessageDeltaEventSchema,
  AgentsUiConversationMessageUpsertEventSchema,
  AgentsUiConversationStatusEventSchema,
  AgentsUiConversationErrorEventSchema,
])

export const WorktreeListResponseSchema = z.object({
  worktrees: z.array(ProjectWorktreeSnapshotSchema),
})

export const UnpushedCommitSchema = z.object({
  hash: z.string(),
  message: z.string(),
})

export const WorktreeDiffResponseSchema = z.object({
  uncommitted: z.string(),
  uncommittedTruncated: z.boolean(),
  gitStatus: z.string(),
  unpushedCommits: z.array(UnpushedCommitSchema),
})

export const ServiceConfigSchema = z.object({
  name: z.string(),
  portEnv: z.string(),
})

export const EnvironmentIdParamsSchema = z.object({ environmentId: z.string().min(1) })
export const EnvironmentServiceParamsSchema = EnvironmentIdParamsSchema.extend({ serviceId: z.string().min(1) })
export const EnvironmentServiceActionRequestSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
})
export const EndpointIdParamsSchema = z.object({ endpointId: z.string().min(1) })
export const EnvironmentStatusSchema = z.enum([
  'detected',
  'resolving',
  'building',
  'starting',
  'ready',
  'stopping',
  'stopped',
  'failed',
  'missing',
  'awaiting_trust',
])
export const EnvironmentCapabilitiesSchema = z.object({
  exec: z.boolean(),
  stdin: z.boolean(),
  pty: z.boolean(),
  resize: z.boolean(),
  signals: z.boolean(),
  reattach: z.boolean(),
  services: z.boolean(),
  rebuild: z.boolean(),
})
export const EnvironmentSecuritySchema = z.object({
  trusted: z.boolean(),
  reasons: z.array(z.string()),
  initializeCommand: z.boolean(),
  privileged: z.boolean(),
  dockerSocket: z.boolean(),
  devices: z.boolean(),
  broadMounts: z.boolean(),
  features: z.array(z.string()),
  unpinnedFeatures: z.array(z.string()).default([]),
  addedCapabilities: z.array(z.string()).default([]),
  securityOptions: z.array(z.string()).default([]),
  secretKeys: z.array(z.string()).default([]),
  isolationRisks: z.array(z.string()).default([]),
})
export const EndpointSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  url: z.string(),
  audiences: z.array(z.enum(['agent', 'taskflow', 'user'])),
  visibility: z.enum(['environment', 'private', 'authenticated', 'public']),
  accessMode: z.enum(['internal', 'localhost', 'lan', 'vpn', 'host', 'public']),
  executionLocus: z.enum(['environment', 'host', 'remote']),
  stable: z.boolean(),
  provider: z.string().optional(),
  providerResourceId: z.string().optional(),
})
export const EnvironmentServiceSchema = z.object({
  id: z.string(),
  environmentId: z.string(),
  name: z.string(),
  status: z.enum(['unknown', 'starting', 'running', 'stopped', 'unhealthy']),
  kind: z.enum(['http', 'tcp', 'database', 'cache', 'queue', 'worker', 'unknown']),
  containerIds: z.array(z.string()),
  ports: z.array(
    z.object({
      containerPort: z.number().int().positive(),
      protocol: z.enum(['http', 'https', 'tcp', 'udp', 'unknown']),
      hostBinding: z.object({ host: z.string(), port: z.number().int().positive() }).optional(),
      label: z.string().optional(),
    }),
  ),
  endpoints: z.array(EndpointSchema),
  provenance: z.array(
    z.object({
      source: z.enum(['taskflow', 'devcontainer', 'compose', 'docker', 'probe', 'runtime']),
      detail: z.string(),
      confidence: z.enum(['explicit', 'observed', 'inferred']),
    }),
  ),
  actions: z.array(z.enum(['start', 'stop', 'restart'])).default([]),
})
export const EnvironmentSchema = z.object({
  id: z.string(),
  provider: z.enum(['host', 'docker', 'compose', 'devcontainer', 'dockerfile']),
  status: EnvironmentStatusSchema,
  desiredStatus: z.enum(['ready', 'stopped', 'destroyed']),
  scope: z.object({
    installationId: z.string(),
    projectId: z.string(),
    workspaceId: z.string(),
    runId: z.string().optional(),
    executionId: z.string().optional(),
    userId: z.string().optional(),
  }),
  workspace: z.object({ hostPath: z.string(), containerPath: z.string().optional() }),
  configRef: z.string().nullable(),
  configHash: z.string(),
  capabilities: EnvironmentCapabilitiesSchema,
  security: EnvironmentSecuritySchema,
  runtimeOverride: z
    .object({
      path: z.string(),
      hash: z.string(),
      diff: z.array(z.string()),
      effective: z.object({
        containerIds: z.array(z.string()),
        cpus: z.number().positive(),
        memory: z.string(),
        memorySwap: z.string(),
        pids: z.number().int().positive(),
      }),
      validated: z.boolean(),
      diagnostics: z.array(z.string()),
    })
    .optional(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export const EnvironmentResponseSchema = z.object({ environment: EnvironmentSchema })
export const EnvironmentServicesResponseSchema = z.object({ services: z.array(EnvironmentServiceSchema) })
export const EnvironmentExecRequestSchema = z.object({
  argv: z.tuple([z.string().min(1)]).rest(z.string()),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
})
export const EnvironmentExecResponseSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
})
export const EnvironmentTerminalResponseSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string(),
})
export const EnvironmentExposeRequestSchema = z.object({ visibility: z.literal('private') })

export const ProfileConfigSchema = z.object({
  name: z.string(),
  systemPrompt: z.string().optional(),
})

export const LinkedRepoInfoSchema = z.object({
  alias: z.string(),
  dir: z.string().optional(),
})

export const MultiplexerKindSchema = z.enum(['tmux', 'herdr'])

export const BuildInfoSchema = z.object({
  version: z.string().min(1),
  builtAt: TimestampSchema,
})

export const AppConfigSchema = z.object({
  name: z.string(),
  /** Which multiplexer backs this project's panes. The browser terminal only
   *  works under tmux — see docs/herdr.md. */
  multiplexer: MultiplexerKindSchema,
  services: z.array(ServiceConfigSchema),
  profiles: z.array(ProfileConfigSchema),
  agents: z.array(AgentSummarySchema),
  defaultProfileName: z.string(),
  defaultAgentId: BuiltInAgentIdSchema,
  autoName: z.boolean(),
  linearCreateTicketOption: z.boolean(),
  startupEnvs: z.record(z.string(), z.union([z.string(), z.boolean()])),
  linkedRepos: z.array(LinkedRepoInfoSchema),
  linearAutoCreateWorktrees: z.boolean(),
  autoRemoveOnMerge: z.boolean(),
  projectDir: z.string(),
  mainBranch: z.string(),
  branchPattern: z.string(),
  build: BuildInfoSchema,
})

export const CiLogsResponseSchema = z.object({
  logs: z.string(),
})

export const WorktreeNameParamsSchema = z.object({
  name: z.string(),
})

export const WorktreeTabParamsSchema = z.object({
  name: z.string(),
  tabId: z.string(),
})

export const CreateTabResponseSchema = z.object({
  tab: WorktreeTabSchema,
})

export const NotificationIdParamsSchema = z.object({
  id: NumberLikePathParamSchema,
})

export const AgentIdParamsSchema = z.object({
  id: AgentIdSchema,
})

export const RunIdParamsSchema = z.object({
  runId: NumberLikePathParamSchema,
})

export const ProjectSummarySchema = z.object({
  prefix: z.string(),
  name: z.string(),
  path: z.string(),
  /** True while at least one client has a terminal/agent WebSocket open on this
   *  project (i.e. it is currently being viewed). */
  active: z.boolean(),
})

export const ProjectsResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
})

export const AddProjectRequestSchema = z.object({
  path: z.string().min(1),
})

/** Adding a repo that has no .portta/taskflow.yaml kicks off an async setup job
 *  (scaffold config → analyze with Claude → register); the response says the
 *  job started and the client polls `projectInits`. When the repo already has
 *  config it's registered immediately and `project` is returned. */
export const AddProjectResponseSchema = z.object({
  initializing: z.boolean(),
  path: z.string(),
  project: ProjectSummarySchema.nullable(),
})

/** Phases of the on-add project setup, surfaced so the UI and CLI can show
 *  progress: scaffold the .portta/taskflow.yaml → analyze the repo with Claude → ready
 *  (registered). `failed` means setup errored before the project was usable. */
export const ProjectInitPhaseSchema = z.enum(['creating_config', 'analyzing', 'ready', 'failed'])

export const ProjectInitStateSchema = z.object({
  path: z.string(),
  phase: ProjectInitPhaseSchema,
  /** Set once the project is registered (phase "ready") so the client can open it. */
  prefix: z.string().nullable(),
  name: z.string().nullable(),
  /** Set when phase is "failed". */
  error: z.string().nullable(),
})

export const ProjectInitsResponseSchema = z.object({
  inits: z.array(ProjectInitStateSchema),
})

export const ProjectPrefixParamsSchema = z.object({
  prefix: z.string(),
})

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>
export type ProjectInitPhase = z.infer<typeof ProjectInitPhaseSchema>
export type ProjectInitState = z.infer<typeof ProjectInitStateSchema>

export type RunMode = z.infer<typeof RunModeSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>
export type AgentTransport = z.infer<typeof AgentTransportSchema>
export type AgentPermissionMode = z.infer<typeof AgentPermissionModeSchema>
export type StdioMcpServer = z.infer<typeof StdioMcpServerSchema>
export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>
export type WorkspaceStrategy = z.infer<typeof WorkspaceStrategySchema>
export type WorkspaceAccess = z.infer<typeof WorkspaceAccessSchema>
export type WorkspaceSelection = z.infer<typeof WorkspaceSelectionSchema>
export type WorkflowWorkspacePolicy = z.infer<typeof WorkflowWorkspacePolicySchema>
export type WorkflowOrigin = z.infer<typeof WorkflowOriginSchema>
export type EventSource = z.infer<typeof EventSourceSchema>
export type SessionCapability = z.infer<typeof SessionCapabilitySchema>
export type Workspace = z.infer<typeof WorkspaceSchema>
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>
export type Execution = z.infer<typeof ExecutionSchema>
export type Run = z.infer<typeof RunSchema>
export type RunDetail = z.infer<typeof RunDetailSchema>
export type TranscriptChunk = z.infer<typeof TranscriptChunkSchema>
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>
export type ExecutionTranscriptResponse = z.infer<typeof ExecutionTranscriptResponseSchema>
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>
export type RunEvent = z.infer<typeof RunEventSchema>
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>
export type RunWorkspaceContext = z.infer<typeof RunWorkspaceContextSchema>
export type RunListResponse = z.infer<typeof RunListResponseSchema>
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>
export type RunEventsResponse = z.infer<typeof RunEventsResponseSchema>
export type BuiltInAgentId = z.infer<typeof BuiltInAgentIdSchema>
export type AgentId = z.infer<typeof AgentIdSchema>
export type AgentKind = z.infer<typeof AgentKindSchema>
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>
export type AgentSummary = z.infer<typeof AgentSummarySchema>
export type AgentDetails = z.infer<typeof AgentDetailsSchema>
export type UpsertCustomAgentRequest = z.infer<typeof UpsertCustomAgentRequestSchema>
export type AgentResponse = z.infer<typeof AgentResponseSchema>
export type ValidateCustomAgentResponse = z.infer<typeof ValidateCustomAgentResponseSchema>
export type WorktreeCreateMode = z.infer<typeof WorktreeCreateModeSchema>
export type PostWorktreeToLinearTarget = z.infer<typeof PostWorktreeToLinearTargetSchema>
export type PostWorktreeToLinearResponse = z.infer<typeof PostWorktreeToLinearResponseSchema>
export type OneshotConfig = z.infer<typeof OneshotConfigSchema>
export type WorktreeCreationPhase = z.infer<typeof WorktreeCreationPhaseSchema>
export type AvailableBranch = z.infer<typeof AvailableBranchSchema>
// Keep this manual so frontend callers pass booleans instead of raw `"true"`/`"false"` query literals.
export type AvailableBranchesQuery = { includeRemote?: boolean }
export type CreateWorktreeRequest = z.infer<typeof CreateWorktreeRequestSchema>
export type OpenWorktreeRequest = z.infer<typeof OpenWorktreeRequestSchema>
export type WorktreeSource = z.infer<typeof WorktreeSourceSchema>
export type CreateWorktreeResponse = z.infer<typeof CreateWorktreeResponseSchema>
export type AgentsSendMessageRequest = z.infer<typeof AgentsSendMessageRequestSchema>
export type PullMainRequest = z.infer<typeof PullMainRequestSchema>
export type PullMainResult = z.infer<typeof PullMainResponseSchema>
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>
export type PrComment = z.infer<typeof PrCommentSchema>
export type CiCheck = z.infer<typeof CiCheckSchema>
export type PrEntry = z.infer<typeof PrEntrySchema>
export type LinearIssueState = z.infer<typeof LinearIssueStateSchema>
export type LinkedLinearIssue = z.infer<typeof LinkedLinearIssueSchema>
export type LinearIssue = z.infer<typeof LinearIssueSchema>
export type LinearIssueAvailability = z.infer<typeof LinearIssueAvailabilitySchema>
export type LinearIssuesResponse = z.infer<typeof LinearIssuesResponseSchema>
export type AutoNameConfigResponse = z.infer<typeof AutoNameConfigResponseSchema>
export type AppNotification = z.infer<typeof AppNotificationSchema>
export type ProjectWorktreeSnapshot = z.infer<typeof ProjectWorktreeSnapshotSchema>
export type WorktreeTab = z.infer<typeof WorktreeTabSchema>
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>
export type WorktreeConversationProvider = z.infer<typeof WorktreeConversationProviderSchema>
export type AgentsUiWorktreeSummary = z.infer<typeof AgentsUiWorktreeSummarySchema>
export type AgentsUiConversationMessage = z.infer<typeof AgentsUiConversationMessageSchema>
export type AgentsUiConversationState = z.infer<typeof AgentsUiConversationStateSchema>
export type AgentsUiWorktreeConversationResponse = z.infer<typeof AgentsUiWorktreeConversationResponseSchema>
export type AgentsUiSendMessageResponse = z.infer<typeof AgentsUiSendMessageResponseSchema>
export type AgentsUiInterruptResponse = z.infer<typeof AgentsUiInterruptResponseSchema>
export type AgentsUiConversationMessageDeltaEvent = z.infer<typeof AgentsUiConversationMessageDeltaEventSchema>
export type AgentsUiConversationMessageUpsertEvent = z.infer<typeof AgentsUiConversationMessageUpsertEventSchema>
export type AgentsUiConversationStatusEvent = z.infer<typeof AgentsUiConversationStatusEventSchema>
export type AgentsUiConversationErrorEvent = z.infer<typeof AgentsUiConversationErrorEventSchema>
export type AgentsUiConversationEvent = z.infer<typeof AgentsUiConversationEventSchema>
export type WorktreeListResponse = z.infer<typeof WorktreeListResponseSchema>
export type UnpushedCommit = z.infer<typeof UnpushedCommitSchema>
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>
export type Environment = z.infer<typeof EnvironmentSchema>
export type EnvironmentService = z.infer<typeof EnvironmentServiceSchema>
export type EnvironmentResponse = z.infer<typeof EnvironmentResponseSchema>
export type EnvironmentServicesResponse = z.infer<typeof EnvironmentServicesResponseSchema>
export type EnvironmentExecRequest = z.infer<typeof EnvironmentExecRequestSchema>
export type EnvironmentExecResponse = z.infer<typeof EnvironmentExecResponseSchema>
export type EnvironmentTerminalResponse = z.infer<typeof EnvironmentTerminalResponseSchema>
export type EnvironmentExposeRequest = z.infer<typeof EnvironmentExposeRequestSchema>
export type EnvironmentServiceActionRequest = z.infer<typeof EnvironmentServiceActionRequestSchema>
export type ProfileConfig = z.infer<typeof ProfileConfigSchema>
export type LinkedRepoInfo = z.infer<typeof LinkedRepoInfoSchema>
export type AppConfig = z.infer<typeof AppConfigSchema>
export type OkResponse = z.infer<typeof OkResponseSchema>
export type DiagnosticCheck = z.infer<typeof DiagnosticCheckSchema>
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>
