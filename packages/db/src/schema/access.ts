// Where a role applies.
//
// The role itself is global (`users.role`); this table says which Projects a
// `developer` or a `viewer` can see. `owner` and `admin` see everything and
// have no rows here — an empty membership list is not a restriction on them.
//
// There is deliberately no per-project role: one role per person keeps "what
// can this person do" answerable without reading a matrix.

import { relations } from 'drizzle-orm'
import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth.ts'
import { createdAt, ref } from './columns.ts'
import { projects } from './projects.ts'

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: ref('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who granted it. Null once that person is removed; the grant survives. */
    grantedBy: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_members_user_idx').on(table.userId),
  ],
)

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id], relationName: 'membership' }),
  grantedByUser: one(users, { fields: [projectMembers.grantedBy], references: [users.id], relationName: 'granted' }),
}))
