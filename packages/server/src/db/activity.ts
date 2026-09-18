// Activity: what happened in the development flow, with references.

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { ACTIVITY_KEEP_DAYS, ACTIVITY_KEEP_PER_PROJECT, type ActivityKind, type ActivitySource } from 'portta-core'
import { activityEvents, type Db } from 'portta-db'

export interface ActivityRow {
  id: string
  at: Date
  kind: ActivityKind
  actor: string | null
  actorKind: 'human' | 'agent' | 'system' | null
  source: ActivitySource | null
  projectId: string | null
  issueRef: string | null
  repositoryId: string | null
  environmentId: string | null
  sessionId: string | null
  summary: string
  data: Record<string, unknown>
}

export interface ActivityInput {
  kind: ActivityKind
  summary: string
  actor?: string | null
  actorKind?: 'human' | 'agent' | 'system' | null
  source?: ActivitySource | null
  projectId?: string | null
  issueRef?: string | null
  repositoryId?: string | null
  environmentId?: string | null
  sessionId?: string | null
  data?: Record<string, unknown>
}

type Row = typeof activityEvents.$inferSelect

const id = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value)

function toRow(row: Row): ActivityRow {
  return {
    ...row,
    id: String(row.id),
    kind: row.kind as ActivityKind,
    projectId: row.projectId === null ? null : String(row.projectId),
    issueRef: row.issueRef,
    repositoryId: row.repositoryId === null ? null : String(row.repositoryId),
    environmentId: row.environmentId === null ? null : String(row.environmentId),
    sessionId: row.sessionId === null ? null : String(row.sessionId),
  }
}

export class ActivityRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async append(input: ActivityInput): Promise<ActivityRow> {
    const [row] = await this.db
      .insert(activityEvents)
      .values({
        kind: input.kind,
        actor: input.actor ?? null,
        actorKind: input.actorKind ?? null,
        source: input.source ?? null,
        projectId: id(input.projectId),
        issueRef: input.issueRef ?? null,
        repositoryId: id(input.repositoryId),
        environmentId: id(input.environmentId),
        sessionId: id(input.sessionId),
        summary: input.summary,
        data: input.data ?? {},
      })
      .returning()
    return toRow(row!)
  }

  async list(
    filter: {
      projectId?: string
      issueRef?: string
      repositoryId?: string
      environmentId?: string
      sessionId?: string
      kinds?: string[]
      since?: Date
      before?: string
      limit?: number
    } = {},
  ): Promise<ActivityRow[]> {
    const where = [
      filter.projectId ? eq(activityEvents.projectId, Number(filter.projectId)) : undefined,
      filter.issueRef ? eq(activityEvents.issueRef, filter.issueRef) : undefined,
      filter.repositoryId ? eq(activityEvents.repositoryId, Number(filter.repositoryId)) : undefined,
      filter.environmentId ? eq(activityEvents.environmentId, Number(filter.environmentId)) : undefined,
      filter.sessionId ? eq(activityEvents.sessionId, Number(filter.sessionId)) : undefined,
      filter.kinds && filter.kinds.length > 0 ? inArray(activityEvents.kind, filter.kinds) : undefined,
      filter.since ? gte(activityEvents.at, filter.since) : undefined,
      filter.before ? lt(activityEvents.id, Number(filter.before)) : undefined,
    ].filter((clause) => clause !== undefined)

    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(activityEvents.at), desc(activityEvents.id))
      .limit(Math.min(Math.max(filter.limit ?? 50, 1), 500))
    return rows.map(toRow)
  }

  /** Bounded history: by age, and by count per project. Called from a timer, never from a request. */
  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ACTIVITY_KEEP_DAYS * 24 * 3600 * 1000)
    const byAge = await this.db
      .delete(activityEvents)
      .where(lt(activityEvents.at, cutoff))
      .returning({ id: activityEvents.id })
    // A window function is the whole point of this statement: keeping the
    // newest N per project in the query builder would mean one round trip per
    // project, from a timer that runs on every panel.
    const byCount = await this.db
      .delete(activityEvents)
      .where(
        sql`${activityEvents.id} IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY at DESC, id DESC) AS rank
            FROM activity_events WHERE project_id IS NOT NULL
          ) ranked WHERE rank > ${ACTIVITY_KEEP_PER_PROJECT}
        )`,
      )
      .returning({ id: activityEvents.id })
    return byAge.length + byCount.length
  }
}
