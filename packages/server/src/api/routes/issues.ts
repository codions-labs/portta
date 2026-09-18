// The panel's work surface: issues that live in GitHub or in Linear.
//
// Every route here is scoped to a Project, because the Project is what decides
// *which* GitHub repository or Linear team the request is about — there is no
// global issue list and no way to name a repository the panel is not linked to
// (ADR 0050). That scoping is also the authorisation boundary: a developer who
// cannot see a Project cannot read its issues through here.
//
// Nothing is stored. A read is a call to the host daemon, which runs `gh` or
// Linear's API, projected into the contract and answered. What Portta adds on
// top is the one thing neither provider knows: which environments are running
// for this issue.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { Issue, IssueRunContext, IssueSummary, IssueVocabulary } from 'portta-contracts'
import { issueRefLabel } from 'portta-core'
import { z } from 'portta-core/zod'
import { type Database, requireDatabase } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope } from '../../services/access-control.ts'
import { recordActivity } from '../../services/activity.ts'
import { FORGE_HTTP_STATUS, ForgeUnavailable, forgeStatus } from '../../services/issues/host-client.ts'
import {
  coordinateFor,
  NoProvider,
  type ProjectWorkFacts,
  type WorkCoordinate,
} from '../../services/issues/provider.ts'
import { issuePanelUrl, readIssue, workFactsFor } from '../../services/issues/read.ts'
import { issueRunContext, startIssueRun } from '../../services/issues/taskflow-work.ts'
import {
  type GhComment,
  type GhIssue,
  githubIssue,
  githubSummary,
  type LinearIssue,
  linearIssue,
  linearSummary,
} from '../../services/issues/view.ts'
import { documentRoute } from '../openapi.ts'

const IssuesResponse = z
  .object({ issues: z.array(IssueSummary) })
  .strict()
  .meta({ ref: 'IssuesResponse' })
const IssueResponse = z.object({ issue: Issue }).strict().meta({ ref: 'IssueResponse' })
const VocabularyResponse = z.object({ vocabulary: IssueVocabulary }).strict().meta({ ref: 'VocabularyResponse' })
const IssueRunContextResponse = z.object({ context: IssueRunContext }).strict().meta({ ref: 'IssueRunContextResponse' })
const StartIssueRunBody = z
  .object({
    harness: z.string().trim().min(1),
    type: z.string().trim().min(1).optional(),
    branch: z.string().trim().min(1).optional(),
  })
  .strict()
  .meta({ ref: 'StartIssueRunBody' })
const StartIssueRunResponse = z.object({ runId: z.string() }).strict().meta({ ref: 'StartIssueRunResponse' })

const CreateIssueBody = z
  .object({
    title: z.string().trim().min(1).max(250),
    body: z.string().max(60_000).optional(),
    labels: z.array(z.string().min(1)).max(20).optional(),
    assignees: z.array(z.string().min(1)).max(10).optional(),
    milestone: z.string().min(1).optional(),
  })
  .strict()
  .meta({ ref: 'CreateIssueBody' })

const PatchIssueBody = z
  .object({
    title: z.string().trim().min(1).max(250).optional(),
    body: z.string().max(60_000).optional(),
    state: z.enum(['open', 'closed']).optional(),
    stateReason: z.enum(['completed', 'not planned']).optional(),
    addLabels: z.array(z.string().min(1)).max(20).optional(),
    removeLabels: z.array(z.string().min(1)).max(20).optional(),
    addAssignees: z.array(z.string().min(1)).max(10).optional(),
    removeAssignees: z.array(z.string().min(1)).max(10).optional(),
    /** An empty string clears the milestone, which is how `gh` spells it too. */
    milestone: z.string().max(200).optional(),
  })
  .strict()
  .meta({ ref: 'PatchIssueBody' })

const CommentBody = z
  .object({ body: z.string().trim().min(1).max(60_000) })
  .strict()
  .meta({ ref: 'CommentBody' })

const keyParameter = {
  name: 'key',
  in: 'path' as const,
  required: true,
  description: "The provider's own identifier: an issue number on GitHub, ENG-42 on Linear.",
  schema: { type: 'string' as const },
}

const FILTERS = [
  ['state', 'open, closed or all. Defaults to open.'],
  ['assignee', 'Provider login. GitHub only.'],
  ['label', 'Exact label name. GitHub only.'],
  ['milestone', 'Milestone title. GitHub only.'],
  ['q', "Free text, passed to the provider's own search. GitHub only."],
] as const

const filterParameters = FILTERS.map(([name, description]) => ({
  name,
  in: 'query' as const,
  required: false,
  description,
  schema: { type: 'string' as const },
}))

/**
 * A provider failure is an answer, not a crash.
 *
 * `gh` missing, nobody signed in, a rate limit and a repository the account
 * cannot see are four different things an operator fixes four different ways,
 * so each keeps its own status and its own hint all the way to the browser.
 */
function refuse(error: unknown): never {
  if (error instanceof ForgeUnavailable) {
    throw new HTTPException(FORGE_HTTP_STATUS[error.kind], {
      message: error.hint ? `${error.message} — ${error.hint}` : error.message,
    })
  }
  if (error instanceof NoProvider) throw new HTTPException(409, { message: `${error.message} — ${error.hint}` })
  throw error
}

export function issueRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * The Project, the scope check, and only then its coordinate.
   *
   * The order is the point. `coordinateFor` refuses a Project with no provider
   * with a 409 that names what is missing, and computing it before the scope
   * check would tell somebody who cannot see the Project whether it is linked
   * to GitHub — a different answer from the 403 they should get, which is the
   * shape of a configuration leak.
   */
  async function open(
    c: Parameters<typeof authorizeScope>[0],
    db: Database,
    slug: string,
  ): Promise<{ facts: ProjectWorkFacts; coordinate: WorkCoordinate; projectId: string }> {
    const project = await db.projects.find(slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    authorizeScope(c, projectScope(project.id))
    const facts = await workFactsFor(db, project)
    return { facts, coordinate: coordinateFor(facts), projectId: project.id }
  }

  app.get(
    '/projects/:slug/issues',
    documentRoute({
      tag: 'Issues',
      operationId: 'listProjectIssues',
      permission: 'issue:read',
      summary: "List a Project's issues, from wherever its work lives",
      response: IssuesResponse,
      description:
        'Read live from GitHub through `gh`, or from Linear. Nothing is mirrored, so this needs the host daemon ' +
        'to be running and the provider to be reachable; it answers 503 rather than an empty list when it is not.',
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, ...filterParameters],
      errors: [401, 403, 404, 409, 500, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { coordinate } = await open(c, db, slug)
        const query = new URL(c.req.url).searchParams
        const state = query.get('state')
        const panelUrl = (ref: string) => issuePanelUrl(slug, ref)

        if (coordinate.provider === 'linear') {
          const rows = await deps.forge.call<LinearIssue[]>({
            path: '/linear/issues',
            query: { team: coordinate.team, state: state ?? undefined },
          })
          return c.json({ issues: rows.map((row) => linearSummary(row, panelUrl)) })
        }
        const rows = await deps.forge.call<GhIssue[]>({
          path: '/issues',
          query: {
            repo: coordinate.repo,
            state: state ?? undefined,
            assignee: query.get('assignee') ?? undefined,
            label: query.get('label') ?? undefined,
            milestone: query.get('milestone') ?? undefined,
            q: query.get('q') ?? undefined,
          },
        })
        return c.json({ issues: rows.map((row) => githubSummary(row, coordinate.repo, panelUrl)) })
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.get(
    '/projects/:slug/issues/:key',
    documentRoute({
      tag: 'Issues',
      operationId: 'getProjectIssue',
      permission: 'issue:read',
      summary: 'One issue, with its body, its comments and the environments running for it',
      response: IssueResponse,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, keyParameter],
      errors: [401, 403, 404, 409, 500, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { facts, coordinate } = await open(c, db, slug)
        return c.json({ issue: await readIssue(deps, db, facts, coordinate, c.req.param('key')) })
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.get(
    '/projects/:slug/issues/:key/run-context',
    documentRoute({
      tag: 'Issues',
      operationId: 'getProjectIssueRunContext',
      permission: 'issue:read',
      summary: 'Whether a Run can start from this issue, and the branch the project would propose',
      response: IssueRunContextResponse,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, keyParameter],
      errors: [401, 403, 404, 409],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { facts, coordinate, projectId } = await open(c, db, slug)
        const issue = await readIssue(deps, db, facts, coordinate, c.req.param('key'))
        return c.json({ context: await issueRunContext(deps, db, projectId, issue.title) })
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.post(
    '/projects/:slug/issues/:key/runs',
    documentRoute({
      tag: 'Issues',
      operationId: 'startProjectIssueRun',
      permission: 'issue:write',
      summary: 'Start a Run that resolves this issue, with a worktree named from the project pattern',
      response: StartIssueRunResponse,
      status: 201,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, keyParameter],
      errors: [400, 401, 403, 404, 409, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { facts, coordinate, projectId } = await open(c, db, slug)
        const draft = StartIssueRunBody.parse(await c.req.json())
        const issue = await readIssue(deps, db, facts, coordinate, c.req.param('key'))
        const result = await startIssueRun(deps, db, {
          projectId,
          issueRef: issue.ref,
          title: issue.title,
          body: issue.body,
          harness: draft.harness,
          ...(draft.type ? { type: draft.type } : {}),
          ...(draft.branch ? { branch: draft.branch } : {}),
        })
        if ('error' in result)
          throw new HTTPException(result.status as 400 | 401 | 403 | 404 | 409 | 502 | 503, { message: result.error })
        await recorded(
          c,
          { id: projectId, slug },
          'issue.updated',
          issue.ref,
          `started a Run for ${issueRefLabel(issue.ref)}`,
        )
        return c.json({ runId: result.runId }, 201)
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.get(
    '/projects/:slug/issues-vocabulary',
    documentRoute({
      tag: 'Issues',
      operationId: 'getProjectIssueVocabulary',
      permission: 'issue:read',
      summary: 'The labels, assignees and milestones a form may offer',
      description:
        'Fetched rather than guessed: an assignee the provider does not recognise is a refused write, and a picker ' +
        'that offered it is the reason. Linear answers an empty vocabulary, because it has none of the three.',
      response: VocabularyResponse,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
      errors: [401, 403, 404, 409, 500, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      try {
        const { coordinate } = await open(c, db, c.req.param('slug'))
        if (coordinate.provider === 'linear') {
          return c.json({ vocabulary: { labels: [], assignees: [], milestones: [] } })
        }
        const raw = await deps.forge.call<{
          labels: Array<{ name: string; color?: string | null; description?: string | null }>
          assignees: Array<{ login: string; avatarUrl?: string | null }>
          milestones: Array<{ number?: number | null; title: string; state?: string | null; dueOn?: string | null }>
        }>({
          path: '/vocabulary',
          query: { repo: coordinate.repo },
        })
        return c.json({
          vocabulary: {
            labels: raw.labels.map((label) => ({
              name: label.name,
              color: label.color ?? null,
              description: label.description ?? null,
            })),
            assignees: raw.assignees.map((user) => ({
              login: user.login,
              name: null,
              avatarUrl: user.avatarUrl ?? null,
            })),
            milestones: raw.milestones.map((milestone) => ({
              title: milestone.title,
              number: milestone.number ?? null,
              state: milestone.state ?? null,
              dueOn: milestone.dueOn ? Math.floor(Date.parse(milestone.dueOn) / 1000) : null,
            })),
          },
        })
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.post(
    '/projects/:slug/issues',
    documentRoute({
      tag: 'Issues',
      operationId: 'createProjectIssue',
      permission: 'issue:write',
      summary: 'Open an issue where this Project’s work lives',
      response: IssueResponse,
      status: 201,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
      errors: [400, 401, 403, 404, 409, 500, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { coordinate, projectId } = await open(c, db, slug)
        const draft = CreateIssueBody.parse(await c.req.json())
        const created =
          coordinate.provider === 'linear'
            ? linearIssue(
                await deps.forge.call<LinearIssue>({
                  path: '/linear/issues',
                  method: 'POST',
                  query: { team: coordinate.team },
                  body: { title: draft.title, body: draft.body },
                }),
                (ref) => issuePanelUrl(slug, ref),
                { environments: [], worktrees: [], activeSessionCount: 0 },
              )
            : githubIssue(
                await deps.forge.call<GhIssue & { comments: GhComment[] }>({
                  path: '/issues',
                  method: 'POST',
                  query: { repo: coordinate.repo },
                  body: draft,
                }),
                coordinate.repo,
                (ref) => issuePanelUrl(slug, ref),
                { environments: [], worktrees: [], activeSessionCount: 0 },
              )
        await recorded(
          c,
          { id: projectId, slug },
          'issue.created',
          created.ref,
          `opened ${issueRefLabel(created.ref)}: ${created.title}`,
        )
        return c.json({ issue: created }, 201)
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.patch(
    '/projects/:slug/issues/:key',
    documentRoute({
      tag: 'Issues',
      operationId: 'patchProjectIssue',
      permission: 'issue:write',
      summary: 'Edit an issue: title, body, state, labels, assignees, milestone',
      description:
        'Labels and assignees are expressed as additions and removals rather than as a replacement set, because ' +
        'that is what both providers accept and it is what makes two people editing at once merge instead of clobber.',
      response: IssueResponse,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, keyParameter],
      errors: [400, 401, 403, 404, 409, 500, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { facts, coordinate, projectId } = await open(c, db, slug)
        const patch = PatchIssueBody.parse(await c.req.json())
        const key = c.req.param('key')
        if (coordinate.provider === 'linear') {
          await deps.forge.call<LinearIssue>({
            path: `/linear/issues/${encodeURIComponent(key)}`,
            method: 'PATCH',
            body: patch,
          })
        } else {
          await deps.forge.call<GhIssue>({
            path: `/issues/${encodeURIComponent(key)}`,
            method: 'PATCH',
            query: { repo: coordinate.repo },
            body: patch,
          })
        }
        const issue = await readIssue(deps, db, facts, coordinate, key)
        if (patch.state) {
          await recorded(
            c,
            { id: projectId, slug },
            'issue.state',
            issue.ref,
            `${patch.state === 'closed' ? 'closed' : 'reopened'} ${issueRefLabel(issue.ref)}`,
          )
        } else {
          await recorded(c, { id: projectId, slug }, 'issue.updated', issue.ref, `edited ${issueRefLabel(issue.ref)}`)
        }
        return c.json({ issue })
      } catch (error) {
        refuse(error)
      }
    },
  )

  app.post(
    '/projects/:slug/issues/:key/comments',
    documentRoute({
      tag: 'Issues',
      operationId: 'commentOnProjectIssue',
      permission: 'issue:write',
      summary: 'Comment on an issue',
      response: IssueResponse,
      status: 201,
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, keyParameter],
      errors: [400, 401, 403, 404, 409, 500, 502, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const slug = c.req.param('slug')
      try {
        const { facts, coordinate, projectId } = await open(c, db, slug)
        const { body } = CommentBody.parse(await c.req.json())
        const key = c.req.param('key')
        const path =
          coordinate.provider === 'linear'
            ? `/linear/issues/${encodeURIComponent(key)}/comments`
            : `/issues/${encodeURIComponent(key)}/comments`
        await deps.forge.call({
          path,
          method: 'POST',
          query: coordinate.provider === 'github' ? { repo: coordinate.repo } : undefined,
          body: { body },
        })
        const issue = await readIssue(deps, db, facts, coordinate, key)
        await recorded(
          c,
          { id: projectId, slug },
          'issue.comment',
          issue.ref,
          `commented on ${issueRefLabel(issue.ref)}`,
        )
        return c.json({ issue }, 201)
      } catch (error) {
        refuse(error)
      }
    },
  )

  /** Whether the host can reach either provider, so the panel can say what is missing. */
  app.get(
    '/issues/status',
    documentRoute({
      tag: 'Issues',
      operationId: 'getForgeStatus',
      permission: 'issue:read',
      summary: 'Whether this host can read and write issues, and what is missing when it cannot',
      response: z
        .object({
          github: z
            .object({
              available: z.boolean(),
              authenticated: z.boolean(),
              account: z.string().nullable(),
              detail: z.string().nullable(),
            })
            .strict(),
          linear: z
            .object({
              available: z.boolean(),
              authenticated: z.boolean(),
              account: z.string().nullable(),
              detail: z.string().nullable(),
            })
            .strict(),
        })
        .strict()
        .meta({ ref: 'ForgeStatusResponse' }),
      errors: [401, 403, 500],
    }),
    async (c) => c.json(await forgeStatus(deps.forge)),
  )

  async function recorded(
    c: Parameters<typeof principalOf>[0],
    project: { id: string; slug: string },
    kind: 'issue.created' | 'issue.updated' | 'issue.state' | 'issue.comment',
    ref: string,
    summary: string,
  ): Promise<void> {
    const principal = principalOf(c)
    await recordActivity(
      { db: deps.db, hub: deps.hub },
      {
        kind,
        summary,
        project: project.slug,
        projectId: project.id,
        issueRef: ref,
        actor: principal.actor,
        actorKind: principal.actorKind,
        source: principal.source,
      },
    )
  }

  return app
}
