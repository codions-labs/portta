// What was done, by whom, to what.
//
// This is not a SIEM and not a work log: `activity_events` already records what
// happened in the development flow. This records the sensitive writes — who
// signed in, who changed a role, who destroyed an environment — so an operator
// can answer "who did that" months later.
//
// `metadata` never holds a request body, a password, a hash, a token or an
// environment variable. A test asserts that.

import { relations, sql } from 'drizzle-orm'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth.ts'
import { createdAt, id, json, ref, vocabulary, vocabularyCheck } from './columns.ts'
import { PRINCIPAL_KIND_VALUES } from './enums.ts'
import { projects } from './projects.ts'

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: id(),
    at: createdAt('at'),
    /** Null once the user is removed. `user_email` keeps the line readable. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email'),
    principalKind: vocabulary('principal_kind', PRINCIPAL_KIND_VALUES).notNull(),
    actor: text('actor').notNull(),
    /** `user.created`, `token.revoked`, … — the closed list in 03 §9. */
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    resourceName: text('resource_name'),
    projectId: ref('project_id').references(() => projects.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    metadata: json<Record<string, unknown>>('metadata').notNull().default(sql`('{}')`),
  },
  (table) => [
    vocabularyCheck('audit_log', table.principalKind, PRINCIPAL_KIND_VALUES),
    index('audit_log_at_idx').on(table.at),
    index('audit_log_user_at_idx').on(table.userId, table.at),
    index('audit_log_project_at_idx').on(table.projectId, table.at),
  ],
)

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
  project: one(projects, { fields: [auditLog.projectId], references: [projects.id] }),
}))
