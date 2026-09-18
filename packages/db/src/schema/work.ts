// Who is working on what, and what happened.
//
// A work session is a person or an agent working on an issue, in a repository,
// in an environment, from a moment to a moment. An activity event is one thing
// that happened in the development flow, with references to the entities it
// concerns. Neither is a log: the process output stays with Docker, and
// activity is pruned — it answers "what happened this week", not audit.
//
// The issue is a ref (`github:owner/repo#113`), not a foreign key. Portta does
// not hold the issue, so there is no row to point at, and a ref survives the
// repository being re-linked or the mirror that never existed.

import { relations, sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth.ts'
import { createdAt, id, json, moment, ref, vocabulary, vocabularyCheck } from './columns.ts'
import { ACTIVITY_SOURCE_VALUES, ACTOR_KIND_VALUES, HUMAN_OR_AGENT_VALUES, SESSION_STATUS_VALUES } from './enums.ts'
import { environments } from './environments.ts'
import { projects, repositories } from './projects.ts'

export const workSessions = sqliteTable(
  'work_sessions',
  {
    id: id(),
    projectId: ref('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    issueRef: text('issue_ref'),
    repositoryId: ref('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
    environmentId: ref('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    actor: text('actor').notNull(),
    actorKind: vocabulary('actor_kind', HUMAN_OR_AGENT_VALUES).notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    agent: text('agent'),
    status: vocabulary('status', SESSION_STATUS_VALUES).notNull().default('active'),
    startedAt: createdAt('started_at'),
    lastActivityAt: createdAt('last_activity_at'),
    endedAt: moment('ended_at'),
    summary: text('summary'),
    headBefore: text('head_before'),
    headAfter: text('head_after'),
    commits: json<Array<{ sha: string; subject: string; at: number }>>('commits').notNull().default(sql`('[]')`),
  },
  (table) => [
    vocabularyCheck('work_sessions', table.actorKind, HUMAN_OR_AGENT_VALUES),
    vocabularyCheck('work_sessions', table.status, SESSION_STATUS_VALUES),
    check('work_sessions_actor_check', sql`trim(${table.actor}) <> ''`),
    index('work_sessions_project_status_idx').on(table.projectId, table.status, table.lastActivityAt),
    index('work_sessions_issue_idx').on(table.issueRef).where(sql`${table.issueRef} IS NOT NULL`),
  ],
)

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: id(),
    at: createdAt('at'),
    kind: text('kind').notNull(),
    actor: text('actor'),
    actorKind: vocabulary('actor_kind', ACTOR_KIND_VALUES),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    source: vocabulary('source', ACTIVITY_SOURCE_VALUES),
    projectId: ref('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    issueRef: text('issue_ref'),
    repositoryId: ref('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
    environmentId: ref('environment_id').references(() => environments.id, { onDelete: 'set null' }),
    sessionId: ref('session_id').references(() => workSessions.id, { onDelete: 'set null' }),
    summary: text('summary').notNull(),
    data: json<Record<string, unknown>>('data').notNull().default(sql`('{}')`),
  },
  (table) => [
    vocabularyCheck('activity_events', table.actorKind, ACTOR_KIND_VALUES),
    vocabularyCheck('activity_events', table.source, ACTIVITY_SOURCE_VALUES),
    check('activity_events_kind_check', sql`trim(${table.kind}) <> ''`),
    index('activity_events_project_at_idx').on(table.projectId, table.at),
    index('activity_events_at_idx').on(table.at),
    index('activity_events_issue_idx').on(table.issueRef, table.at).where(sql`${table.issueRef} IS NOT NULL`),
  ],
)

export const workSessionsRelations = relations(workSessions, ({ one }) => ({
  project: one(projects, { fields: [workSessions.projectId], references: [projects.id] }),
  repository: one(repositories, { fields: [workSessions.repositoryId], references: [repositories.id] }),
  environment: one(environments, { fields: [workSessions.environmentId], references: [environments.id] }),
  user: one(users, { fields: [workSessions.userId], references: [users.id] }),
}))

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  project: one(projects, { fields: [activityEvents.projectId], references: [projects.id] }),
  session: one(workSessions, { fields: [activityEvents.sessionId], references: [workSessions.id] }),
  user: one(users, { fields: [activityEvents.userId], references: [users.id] }),
}))
