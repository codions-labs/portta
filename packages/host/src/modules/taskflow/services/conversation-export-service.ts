import {
  AgentIdSchema,
  AgentsUiConversationMessageKindSchema,
  AgentsUiConversationMessageSchema,
  type AgentsUiConversationState,
} from 'portta-contracts/taskflow'
import { APP_NAME, LINEAR_IDENTITY } from 'portta-core/taskflow/config'
import { z } from 'zod'
import { log } from '../lib/log.ts'
import {
  type attachToIssue,
  buildLinearSummaryMarkdown,
  buildTaskflowAttachmentTitle,
  type createIssueComment,
  type createLinearIssue,
  fetchIssueWithAttachments,
  type fetchTeamByKey,
  findLinkedGitHubPr,
  findTaskflowAttachment,
  type LinearIssueWithAttachments,
  type uploadAttachmentFile,
} from './linear-service.ts'

// ── Types ──────────────────────────────────────────────────────────────────

const TaskflowConversationAttachmentMessageSchema = AgentsUiConversationMessageSchema.extend({
  order: z.number().int().nonnegative().optional(),
  kind: AgentsUiConversationMessageKindSchema.optional(),
})

const TaskflowConversationAttachmentPayloadSchema = z.object({
  [LINEAR_IDENTITY.attachmentPayloadKey]: z.literal(1),
  branch: z.string(),
  baseBranch: z.string().nullable(),
  agent: AgentIdSchema.nullable(),
  createdAt: z.string(),
  conversation: z.array(TaskflowConversationAttachmentMessageSchema).transform((messages) =>
    messages.map((message, order) => ({
      ...message,
      order: message.order ?? order,
      kind: message.kind ?? 'text',
    })),
  ),
})

export type TaskflowConversationAttachmentPayload = z.infer<typeof TaskflowConversationAttachmentPayloadSchema>

export function parseTaskflowConversationAttachmentPayload(raw: unknown): TaskflowConversationAttachmentPayload | null {
  const parsed = TaskflowConversationAttachmentPayloadSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export interface ExportTargetIssue {
  kind: 'issue'
  issueId: string
}

export interface ExportTargetTeam {
  kind: 'team'
  teamKey: string
  title?: string
}

export type ExportTarget = ExportTargetIssue | ExportTargetTeam

export interface ExportConversationInput {
  target: ExportTarget
  branch: string
  baseBranch: string | null
  agent: string | null
  prUrl: string | null
  conversation: AgentsUiConversationState
  taskflowVersion?: string
  now?: () => Date
}

export interface ExportConversationDependencies {
  fetchIssueWithAttachments: typeof fetchIssueWithAttachments
  fetchTeamByKey: typeof fetchTeamByKey
  createLinearIssue: typeof createLinearIssue
  uploadAttachmentFile: typeof uploadAttachmentFile
  attachToIssue: typeof attachToIssue
  createIssueComment: typeof createIssueComment
}

export interface ExportedConversation {
  issueId: string
  issueUrl: string
  commentUrl: string | null
  attachmentUrl: string
}

export type ExportConversationResult =
  | { ok: true; data: ExportedConversation }
  | { ok: false; error: string; status: number }

export interface SeedFromLinearInput {
  issueId: string
  preferBranch?: string
}

export interface SeedFromLinearDependencies {
  fetchIssueWithAttachments: typeof fetchIssueWithAttachments
  downloadTaskflowAttachment: (
    url: string,
  ) => Promise<{ ok: true; data: TaskflowConversationAttachmentPayload } | { ok: false; error: string }>
}

/** Production-default deps for `buildSeedFromLinear`. Use this in every
 *  call site that doesn't need to stub the Linear/HTTP side; tests should
 *  pass their own deps object instead. */
export const defaultSeedFromLinearDeps: SeedFromLinearDependencies = {
  fetchIssueWithAttachments,
  downloadTaskflowAttachment: downloadTaskflowAttachmentDefault,
}

export interface LinearSeedResult {
  source: typeof LINEAR_IDENTITY.attachmentSource | 'github-integration' | 'none'
  branch: string | null
  baseBranch: string | null
  prUrl: string | null
  conversationMarkdown: string | null
}

export type BuildSeedResult = { ok: true; data: LinearSeedResult } | { ok: false; error: string; status: number }

// ── Pure helpers ───────────────────────────────────────────────────────────

export function countConversationTurns(conversation: AgentsUiConversationState): number {
  return new Set(conversation.messages.map((m) => m.turnId)).size
}

function escapeFence(text: string): string {
  // Defensive: an assistant message could theoretically contain ``` which would
  // close our fenced block. Replace inner triple-backticks with a zero-width
  // separator so the rendered markdown stays a single block.
  return text.replace(/```/g, '``​`')
}

export function buildConversationAttachmentPayload(
  input: ExportConversationInput,
): TaskflowConversationAttachmentPayload {
  const now = input.now ?? (() => new Date())
  return {
    [LINEAR_IDENTITY.attachmentPayloadKey]: 1,
    branch: input.branch,
    baseBranch: input.baseBranch,
    agent: input.agent,
    createdAt: now().toISOString(),
    conversation: input.conversation.messages,
  }
}

// ── Orchestrators ──────────────────────────────────────────────────────────

async function resolveIssue(
  input: ExportConversationInput,
  deps: ExportConversationDependencies,
): Promise<{ ok: true; issueId: string; issueUrl: string } | { ok: false; error: string; status: number }> {
  if (input.target.kind === 'issue') {
    const issue = await deps.fetchIssueWithAttachments(input.target.issueId)
    if (!issue.ok) return issue
    return { ok: true, issueId: issue.data.id, issueUrl: issue.data.url }
  }

  const team = await deps.fetchTeamByKey(input.target.teamKey)
  if (!team.ok) return team

  const titleFromPrompt = input.target.title?.trim()
  const title = titleFromPrompt && titleFromPrompt.length > 0 ? titleFromPrompt : `${APP_NAME} session: ${input.branch}`
  const description = [
    `Created from a ${APP_NAME} session on branch \`${input.branch}\`.`,
    input.prUrl ? `\nPR: ${input.prUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const created = await deps.createLinearIssue({
    teamId: team.data.id,
    title,
    description,
  })
  if (!created.ok) return { ok: false, error: created.error, status: 502 }
  return { ok: true, issueId: created.data.id, issueUrl: created.data.url }
}

export async function exportConversationToLinear(
  input: ExportConversationInput,
  deps: ExportConversationDependencies,
): Promise<ExportConversationResult> {
  const issue = await resolveIssue(input, deps)
  if (!issue.ok) return issue

  const payload = buildConversationAttachmentPayload(input)
  const attachmentTitle = buildTaskflowAttachmentTitle(input.branch)
  const bodyBytes = new TextEncoder().encode(JSON.stringify(payload, null, 2))
  const filename = `${attachmentTitle}.json`

  const upload = await deps.uploadAttachmentFile({
    filename,
    contentType: 'application/json',
    body: bodyBytes.buffer as ArrayBuffer,
  })
  if (!upload.ok) {
    return { ok: false, error: `Linear file upload failed: ${upload.error}`, status: 502 }
  }

  const attached = await deps.attachToIssue({
    issueId: issue.issueId,
    title: attachmentTitle,
    url: upload.data.assetUrl,
    subtitle: input.prUrl ?? undefined,
  })
  if (!attached.ok) {
    return { ok: false, error: `Linear attachmentCreate failed: ${attached.error}`, status: 502 }
  }

  const summary = buildLinearSummaryMarkdown({
    branch: input.branch,
    baseBranch: input.baseBranch ?? undefined,
    turns: countConversationTurns(input.conversation),
    prUrl: input.prUrl ?? undefined,
    attachmentTitle,
    taskflowVersion: input.taskflowVersion,
  })

  const comment = await deps.createIssueComment({
    issueId: issue.issueId,
    body: summary,
  })
  // Comment failure is non-fatal: the attachment is already saved.
  let commentUrl: string | null = null
  if (comment.ok) {
    commentUrl = comment.data.url
  } else {
    log.error(`[linear] comment creation failed (attachment still saved): ${comment.error}`)
  }

  return {
    ok: true,
    data: {
      issueId: issue.issueId,
      issueUrl: issue.issueUrl,
      attachmentUrl: upload.data.assetUrl,
      commentUrl,
    },
  }
}

// ── Seed resolution (from-linear) ──────────────────────────────────────────

function buildIssueHeader(issue: LinearIssueWithAttachments): string {
  const lines: string[] = []
  lines.push(`This worktree is for Linear issue **${issue.identifier}** — ${issue.url}`)
  lines.push('')
  lines.push(
    `When opening a PR, reference \`Fixes ${issue.identifier}\` in the title or body so Linear links it back automatically (Linear also auto-links PRs on the branch \`${issue.branchName}\`).`,
  )
  lines.push('')
  lines.push(`## Issue: ${issue.title}`)
  if (issue.description?.trim()) {
    lines.push('')
    lines.push(escapeFence(issue.description.trim()))
  }
  lines.push('')
  return lines.join('\n')
}

function buildPriorConversationSection(payload: TaskflowConversationAttachmentPayload): string {
  const lines: string[] = []
  lines.push(`---`)
  lines.push('')
  lines.push(
    `A previous ${APP_NAME} session for this issue was saved here (branch \`${payload.branch}\`${payload.baseBranch ? `, base \`${payload.baseBranch}\`` : ''}).`,
  )
  lines.push('')
  lines.push('Previous conversation (chronological):')
  lines.push('')
  for (const message of payload.conversation) {
    lines.push(`### ${message.role}`)
    lines.push('')
    lines.push(escapeFence(message.text))
    lines.push('')
  }
  return lines.join('\n')
}

export async function buildSeedFromLinear(
  input: SeedFromLinearInput,
  deps: SeedFromLinearDependencies,
): Promise<BuildSeedResult> {
  const issue = await deps.fetchIssueWithAttachments(input.issueId)
  if (!issue.ok) return issue

  const issueHeader = buildIssueHeader(issue.data)
  const taskflowAttachment = findTaskflowAttachment(issue.data, input.preferBranch)
  const pr = findLinkedGitHubPr(issue.data)

  let attachmentPayload: TaskflowConversationAttachmentPayload | null = null
  if (taskflowAttachment) {
    const payloadResult = await deps.downloadTaskflowAttachment(taskflowAttachment.url)
    if (payloadResult.ok) {
      attachmentPayload = payloadResult.data
    } else {
      log.error(`[linear] ${APP_NAME} attachment download failed: ${payloadResult.error}`)
    }
  }

  const source: LinearSeedResult['source'] = attachmentPayload
    ? LINEAR_IDENTITY.attachmentSource
    : pr
      ? 'github-integration'
      : 'none'

  const branch = attachmentPayload?.branch ?? pr?.branch ?? (issue.data.branchName || null)
  const baseBranch = attachmentPayload?.baseBranch ?? null

  const conversationMarkdown = attachmentPayload
    ? `${issueHeader}${buildPriorConversationSection(attachmentPayload)}`
    : issueHeader

  return {
    ok: true,
    data: {
      source,
      branch,
      baseBranch,
      prUrl: pr?.url ?? null,
      conversationMarkdown,
    },
  }
}

// ── I/O boundary: fetch a taskflow attachment body via authenticated GET ─────

export async function downloadTaskflowAttachmentDefault(
  url: string,
): Promise<{ ok: true; data: TaskflowConversationAttachmentPayload } | { ok: false; error: string }> {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) return { ok: false, error: 'LINEAR_API_KEY not set' }

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    })
    if (!res.ok) {
      return { ok: false, error: `Asset download failed ${res.status}` }
    }
    const text = await res.text()
    const parsed = parseTaskflowConversationAttachmentPayload(JSON.parse(text))
    if (!parsed) {
      return { ok: false, error: `Asset is not a ${APP_NAME} conversation payload` }
    }
    return { ok: true, data: parsed }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
