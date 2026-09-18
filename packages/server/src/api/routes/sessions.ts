// Development sessions: a person or an agent working on an issue, in a
// repository, in an environment, from a moment to a moment.

import { type Context, Hono } from 'hono'

/** Who asked. Recorded on the session and its activity; never sent to a provider. */
const ACTOR_HEADER = {
  name: 'X-Portta-Actor',
  in: 'header' as const,
  required: false,
  description: 'Who asked. Recorded on the session and its activity; never sent to a provider.',
  schema: { type: 'string' as const },
}

import { HTTPException } from 'hono/http-exception'
import { authorizeScope, principalOf } from 'portta-auth-core/hono'
import { Session } from 'portta-contracts'
import { z } from 'zod'
import { type Database, requireDatabase } from '../../db/index.ts'
import { StartSession, UpdateSession } from '../../db/work-sessions.ts'
import type { AppDeps } from '../../deps.ts'
import { projectScope } from '../../services/access-control.ts'
import { recordActivity } from '../../services/activity.ts'
import { loadNames, sessionView } from '../../services/activity-view.ts'
import { OverrideRefused } from '../../services/overrides.ts'
import { documentRoute } from '../openapi.ts'

const SessionsResponse = z
  .object({ sessions: z.array(Session) })
  .strict()
  .meta({ ref: 'SessionsResponse' })
const StartSessionBody = StartSession.omit({ actor: true, actorKind: true, environmentId: true })
  .extend({
    environment: z.string().max(255).nullable().optional().describe('COMPOSE_PROJECT_NAME'),
  })
  .strict()
  .meta({ ref: 'StartSessionBody' })
const UpdateSessionBody = UpdateSession.omit({ environmentId: true })
  .extend({
    environment: z.string().max(255).nullable().optional(),
  })
  .strict()
  .meta({ ref: 'UpdateSessionBody' })

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The Project slug.',
  schema: { type: 'string' as const },
}
const idParameter = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: 'The session id.',
  schema: { type: 'string' as const },
}

export function sessionRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /**
   * The Project a route named, and whether this caller reaches it.
   *
   * Both halves together, deliberately: a lookup that returned the row without
   * asking would be one `authorizeScope` away from a leak, and forgetting it is
   * exactly the mistake nothing else catches.
   */
  async function requireProject(c: Context, db: Database, slug: string) {
    const project = await db.projects.find(slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    authorizeScope(c, projectScope(project.id))
    return project
  }

  async function environmentIdOf(db: Database, name: string | null | undefined): Promise<string | null | undefined> {
    if (name === undefined) return undefined
    if (name === null) return null
    const record = await db.environments.find(name)
    if (!record) throw new OverrideRefused(`no environment '${name}' is known to this panel`)
    return record.id
  }

  /**
   * A session, and whether this caller reaches the Project it is in.
   *
   * The global `/sessions/:id` routes have no slug in the path. Looking the
   * row up and returning it without asking is the leak `requireProject`
   * exists to prevent on the Project-scoped verbs.
   */
  async function requireSession(c: Context, db: Database, id: string) {
    const row = await db.sessions.find(id)
    if (!row) throw new HTTPException(404, { message: `no session '${id}'` })
    authorizeScope(c, projectScope(row.projectId))
    return row
  }

  /**
   * The issue ref is not checked against the provider.
   *
   * A session records what somebody said they were working on, and the panel
   * would have to call GitHub to disagree — which would make opening a session
   * fail when GitHub is down, for no gain: a session pointing at an issue that
   * does not exist is a wrong label on a row, not a broken invariant.
   */
  async function assertSessionAssociations(
    db: Database,
    projectId: string,
    patch: { repositoryId?: string | null },
  ): Promise<void> {
    if (patch.repositoryId) {
      const repository = await db.repositories.find(patch.repositoryId)
      if (!repository || repository.projectId !== projectId) {
        throw new OverrideRefused('that repository does not belong to this Project')
      }
    }
  }

  async function present(db: Database, id: string): Promise<Session> {
    const row = await db.sessions.find(id)
    if (!row) throw new HTTPException(404, { message: `no session '${id}'` })
    return sessionView(await loadNames(db), row)
  }

  app.get(
    '/projects/:slug/sessions',
    documentRoute({
      tag: 'Sessions',
      operationId: 'listProjectSessions',
      permission: 'worksession:read',
      summary: "A Project's sessions, most recent first",
      response: SessionsResponse,
      parameters: [
        slugParameter,
        {
          name: 'active',
          in: 'query',
          required: false,
          description: 'true for active sessions only.',
          schema: { type: 'string' },
        },
        {
          name: 'issue',
          in: 'query',
          required: false,
          description: 'An issue ref to limit sessions to, such as github:owner/repo#113.',
          schema: { type: 'string' },
        },
      ],
      errors: [404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const project = await requireProject(c, db, c.req.param('slug'))
      const params = new URL(c.req.url).searchParams
      const active = params.get('active') === 'true'
      const issueRef = params.get('issue')?.trim() || null
      const names = await loadNames(db)
      const rows = await db.sessions.list({
        projectId: project.id,
        ...(active ? { status: ['active'] } : {}),
        ...(issueRef ? { issueRef } : {}),
      })
      return c.json({ sessions: rows.map((row) => sessionView(names, row)) })
    },
  )

  app.post(
    '/projects/:slug/sessions',
    documentRoute({
      tag: 'Sessions',
      operationId: 'startSession',
      permission: 'worksession:write',
      summary: 'Start a session',
      description: 'The actor is X-Portta-Actor, or the operator. An agent’s session is an agent session.',
      request: StartSessionBody,
      response: Session,
      status: 201,
      parameters: [slugParameter, ACTOR_HEADER],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const project = await requireProject(c, db, c.req.param('slug'))
      const body = StartSessionBody.parse(await c.req.json().catch(() => ({})))
      const principal = principalOf(c)
      const { environment, ...rest } = body
      const environmentId = await environmentIdOf(db, environment)
      await assertSessionAssociations(db, project.id, rest)
      const actor = principal.actor ?? 'operator'
      const row = await db.sessions.start(
        project.id,
        {
          ...rest,
          ...(environmentId !== undefined ? { environmentId } : {}),
          agent: rest.agent ?? (principal.actorKind === 'agent' ? principal.actor : null),
        },
        actor,
        principal.actorKind,
      )
      await recordActivity(
        { db, hub: deps.hub },
        {
          kind: 'session.started',
          actor,
          actorKind: principal.actorKind,
          project: project.slug,
          projectId: project.id,
          issueRef: row.issueRef,
          repositoryId: row.repositoryId,
          environmentId: row.environmentId,
          sessionId: row.id,
          summary: `${actor} started working${row.summary ? `: ${row.summary}` : ''}`,
        },
      )
      deps.hub.publish({
        kind: 'session',
        action: 'started',
        id: row.id,
        name: actor,
        project: project.slug,
        ownership: null,
        at: Math.floor(Date.now() / 1000),
      })
      return c.json(await present(db, row.id), 201)
    },
  )

  app.get(
    '/sessions/:id',
    documentRoute({
      tag: 'Sessions',
      operationId: 'getSession',
      permission: 'worksession:read',
      summary: 'One session',
      response: Session,
      parameters: [idParameter],
      errors: [403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const current = await requireSession(c, db, c.req.param('id'))
      return c.json(await present(db, current.id))
    },
  )

  app.patch(
    '/sessions/:id',
    documentRoute({
      tag: 'Sessions',
      operationId: 'updateSession',
      permission: 'worksession:write',
      summary: 'Heartbeat, end, or describe a session',
      description: 'Any patch is a heartbeat. Only the session’s own actor, or the operator, may end it.',
      request: UpdateSessionBody,
      response: Session,
      parameters: [idParameter, ACTOR_HEADER],
      errors: [400, 403, 404, 500, 503],
    }),
    async (c) => {
      const db = requireDatabase(deps.db)
      const current = await requireSession(c, db, c.req.param('id'))
      const body = UpdateSessionBody.parse(await c.req.json().catch(() => ({})))
      const principal = principalOf(c)
      if (
        body.status &&
        body.status !== 'active' &&
        principal.actorKind === 'agent' &&
        principal.actor !== current.actor
      ) {
        throw new HTTPException(403, { message: `only ${current.actor} or the operator may end this session` })
      }
      const wasActive = current.status === 'active'
      const { environment, ...rest } = body
      const environmentId = await environmentIdOf(db, environment)
      await assertSessionAssociations(db, current.projectId, rest)
      const updated = await db.sessions.update(current.id, {
        ...rest,
        ...(environmentId !== undefined ? { environmentId } : {}),
      })
      if (!updated) throw new HTTPException(404, { message: `no session '${current.id}'` })
      if (wasActive && updated.status !== 'active') {
        const slug = (await db.projects.list()).find((project) => project.id === updated.projectId)?.slug ?? null
        await recordActivity(
          { db, hub: deps.hub },
          {
            kind: updated.status === 'ended' ? 'session.ended' : 'session.abandoned',
            actor: principal.actor ?? updated.actor,
            actorKind: principal.actorKind,
            project: slug,
            projectId: updated.projectId,
            issueRef: updated.issueRef,
            repositoryId: updated.repositoryId,
            environmentId: updated.environmentId,
            sessionId: updated.id,
            summary: `${updated.actor} stopped working${updated.summary ? `: ${updated.summary}` : ''}`,
            data: { commits: updated.commits.length },
          },
        )
        deps.hub.publish({
          kind: 'session',
          action: updated.status,
          id: updated.id,
          name: updated.actor,
          project: slug,
          ownership: null,
          at: Math.floor(Date.now() / 1000),
        })
      }
      return c.json(await present(db, updated.id))
    },
  )

  return app
}
