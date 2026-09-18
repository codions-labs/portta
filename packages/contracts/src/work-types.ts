// The contract for work: issues that live somewhere else, and the sessions and
// activity Portta records around them. Zod is the single source of truth, as in
// types.ts; kept in its own file so the work model can grow without the
// infrastructure contract moving.
//
// Portta does not own an issue. These shapes are a *projection* of what GitHub
// or Linear answered, built at request time and never stored
// (docs/development/adr/0050-work-lives-in-an-external-provider.md). That is
// why nothing here has a Portta id: the `ref` is the identity, and it is the
// provider's identity rather than a row this panel could renumber.
//
// The shape is deliberately the intersection of the two providers, not the
// union. A field only exists here when both can answer it or when the one that
// cannot can answer `null` honestly — which is what keeps the panel from
// growing a `if (provider === …)` in every component.

import { ACTIVITY_KINDS, ACTIVITY_SOURCES, ACTOR_KINDS, ISSUE_STATES, TASK_PROVIDERS } from 'portta-core/browser'
import { z } from 'zod'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const TaskProvider = named(z.enum(TASK_PROVIDERS), 'TaskProvider')
export type TaskProvider = z.infer<typeof TaskProvider>

export const IssueState = named(z.enum(ISSUE_STATES), 'IssueState')
export type IssueState = z.infer<typeof IssueState>

export const ActorKind = named(z.enum(ACTOR_KINDS), 'ActorKind')
export type ActorKind = z.infer<typeof ActorKind>

/**
 * How Portta names one issue, everywhere: `github:owner/repo#113`,
 * `linear:ENG-42`.
 *
 * It is the only thing Portta stores about an issue, it is what a URL segment
 * carries, and it is what `portta-core`'s `parseIssueRef` validates. The regex
 * here is the loose gate — the exact per-provider shape is checked by that
 * function, in one place, rather than duplicated into the contract.
 */
export const IssueRef = named(
  z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(/^[a-z]+:.+$/, 'must be provider:key, such as github:owner/repo#113'),
  'IssueRef',
)
export type IssueRef = z.infer<typeof IssueRef>

export const IssueUser = named(
  z
    .object({
      login: z.string(),
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .strict(),
  'IssueUser',
)
export type IssueUser = z.infer<typeof IssueUser>

export const IssueLabel = named(
  z
    .object({
      name: z.string(),
      /** Six hex digits, no `#`. Null where the provider has no colour for it. */
      color: z.string().nullable(),
      description: z.string().nullable(),
    })
    .strict(),
  'IssueLabel',
)
export type IssueLabel = z.infer<typeof IssueLabel>

export const IssueMilestone = named(
  z
    .object({
      title: z.string(),
      /** GitHub numbers milestones; a Linear cycle or project does not. */
      number: z.number().int().nullable(),
      state: z.string().nullable(),
      dueOn: unixSeconds.nullable(),
    })
    .strict(),
  'IssueMilestone',
)
export type IssueMilestone = z.infer<typeof IssueMilestone>

/**
 * An environment running for this issue, and why Portta thinks so.
 *
 * This is the one thing in the projection that is Portta's own: the link comes
 * from `environment_issues`, from a label the environment declares, or from its
 * branch or namespace. Neither GitHub nor Linear knows about it.
 */
export const IssueEnvironmentLink = named(
  z
    .object({
      environment: z.string().describe('COMPOSE_PROJECT_NAME'),
      source: z.enum(['manual', 'label', 'branch', 'namespace']),
      reason: z.string(),
      running: z.boolean(),
      serviceCount: z.number().int(),
      runningCount: z.number().int(),
      unhealthyCount: z.number().int(),
      branch: z.string().nullable(),
      urls: z.array(z.object({ url: z.string(), scope: z.string() }).strict()),
      panelUrl: z.string(),
    })
    .strict(),
  'IssueEnvironmentLink',
)
export type IssueEnvironmentLink = z.infer<typeof IssueEnvironmentLink>

/**
 * A Taskflow worktree working on this issue, and the Run or PR that belongs
 * to it when Portta can see one. The issue body stays on the provider.
 */
export const IssueWorktreeLink = named(
  z
    .object({
      branch: z.string(),
      path: z.string(),
      runId: z.string().nullable(),
      runStatus: z.string().nullable(),
      pullRequestUrl: z.string().nullable(),
      pullRequestState: z.string().nullable(),
    })
    .strict(),
  'IssueWorktreeLink',
)
export type IssueWorktreeLink = z.infer<typeof IssueWorktreeLink>

export const IssueRunContext = named(
  z
    .object({
      available: z.boolean(),
      branchPattern: z.string(),
      proposedBranch: z.string(),
      defaultType: z.string(),
      types: z.array(z.string()),
      agents: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
      defaultAgentId: z.string().nullable(),
    })
    .strict(),
  'IssueRunContext',
)
export type IssueRunContext = z.infer<typeof IssueRunContext>

export const IssueSummary = named(
  z
    .object({
      ref: IssueRef,
      provider: TaskProvider,
      /** `113` on GitHub, `ENG-42` on Linear. What a person types and reads. */
      key: z.string(),
      title: z.string(),
      state: IssueState,
      /** `completed`, `not_planned`, or a Linear state name. Null when open. */
      stateReason: z.string().nullable(),
      labels: z.array(IssueLabel),
      assignees: z.array(IssueUser),
      milestone: IssueMilestone.nullable(),
      author: IssueUser.nullable(),
      commentCount: z.number().int(),
      createdAt: unixSeconds,
      updatedAt: unixSeconds,
      /** Where it is, on the provider. Always present: a ref nobody can open is not useful. */
      url: z.string(),
      panelUrl: z.string(),
    })
    .strict(),
  'IssueSummary',
)
export type IssueSummary = z.infer<typeof IssueSummary>

export const IssueComment = named(
  z
    .object({
      id: z.string(),
      author: IssueUser.nullable(),
      body: z.string(),
      createdAt: unixSeconds,
      updatedAt: unixSeconds.nullable(),
      url: z.string().nullable(),
    })
    .strict(),
  'IssueComment',
)
export type IssueComment = z.infer<typeof IssueComment>

export const Issue = named(
  IssueSummary.extend({
    body: z.string().nullable(),
    comments: z.array(IssueComment),
    environments: z.array(IssueEnvironmentLink),
    worktrees: z.array(IssueWorktreeLink),
    activeSessionCount: z.number().int(),
  }).strict(),
  'Issue',
)
export type Issue = z.infer<typeof Issue>

/**
 * What a project can be written to, as the provider answered it.
 *
 * Fetched once when a form opens rather than guessed: an assignee GitHub does
 * not recognise is a refused write, and a picker that offered it is the reason.
 */
export const IssueVocabulary = named(
  z
    .object({
      labels: z.array(IssueLabel),
      assignees: z.array(IssueUser),
      milestones: z.array(IssueMilestone),
    })
    .strict(),
  'IssueVocabulary',
)
export type IssueVocabulary = z.infer<typeof IssueVocabulary>

export const SessionStatus = named(z.enum(['active', 'ended', 'abandoned']), 'SessionStatus')
export type SessionStatus = z.infer<typeof SessionStatus>

export const Session = named(
  z
    .object({
      id: z.string(),
      project: z.string().describe('Project slug'),
      /**
       * The issue being worked on, as a ref.
       *
       * A ref rather than an embedded issue: listing sessions would otherwise
       * mean one provider call per row, and a session outlives the issue's
       * availability — the panel can say what somebody worked on even when
       * GitHub is unreachable.
       */
      issueRef: IssueRef.nullable(),
      repository: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
      environment: z.string().nullable(),
      actor: z.string(),
      actorKind: z.enum(['human', 'agent']),
      agent: z.string().nullable(),
      status: SessionStatus,
      startedAt: unixSeconds,
      lastActivityAt: unixSeconds,
      endedAt: unixSeconds.nullable(),
      summary: z.string().nullable(),
      headBefore: z.string().nullable(),
      headAfter: z.string().nullable(),
      commits: z.array(z.object({ sha: z.string(), subject: z.string(), at: unixSeconds }).strict()),
    })
    .strict(),
  'Session',
)
export type Session = z.infer<typeof Session>

export const ActivityKind = named(z.enum(ACTIVITY_KINDS), 'ActivityKind')
export type ActivityKind = z.infer<typeof ActivityKind>
export const ActivitySource = named(z.enum(ACTIVITY_SOURCES), 'ActivitySource')
export type ActivitySource = z.infer<typeof ActivitySource>

export const ActivityEvent = named(
  z
    .object({
      id: z.string(),
      at: unixSeconds,
      kind: ActivityKind,
      actor: z.string().nullable(),
      actorKind: ActorKind.nullable(),
      source: ActivitySource.nullable(),
      summary: z.string(),
      project: z.string().nullable().describe('Project slug'),
      issueRef: IssueRef.nullable(),
      repositoryId: z.string().nullable(),
      repositoryName: z.string().nullable(),
      environment: z.string().nullable().describe('COMPOSE_PROJECT_NAME'),
      sessionId: z.string().nullable(),
      data: z.record(z.string(), z.unknown()),
    })
    .strict(),
  'ActivityEvent',
)
export type ActivityEvent = z.infer<typeof ActivityEvent>
