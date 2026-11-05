// The Project: what the operator decided exists.
//
// A Project does not disappear when nothing is running, which is the whole
// point of it being a decision rather than an observation (ADR 0013, ADR 0031).

import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAt, flag, id, updatedAt } from './columns.ts'

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    archived: flag('archived').notNull().default(false),
    /** Kept at the top of the list. One flag for everybody, a decision about the product and not a preference. */
    pinned: flag('pinned').notNull().default(false),
    /**
     * The directory under Projects Home (`group/storefront`), at any depth,
     * never an absolute path and never the identity: changing PORTTA_PROJECTS_HOME must
     * not invent new Projects (ADR 0031).
     */
    relativePath: text('relative_path'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('projects_slug_check', sql`trim(${table.slug}) <> ''`),
    check('projects_name_check', sql`trim(${table.name}) <> ''`),
    check(
      'projects_relative_path_check',
      sql`${table.relativePath} IS NULL OR (trim(${table.relativePath}) <> '' AND ${table.relativePath} NOT LIKE '/%' AND ${table.relativePath} NOT LIKE '%..%' AND ${table.relativePath} NOT LIKE '%/')`,
    ),
    uniqueIndex('projects_relative_path_unique').on(table.relativePath).where(sql`${table.relativePath} IS NOT NULL`),
  ],
)

/**
 * A label the operator puts on a Project to find it by: `cliente: Acme`, or just
 * `loja`. The key is empty for a bare one. It groups and filters; it never grants
 * or hides anything, which is why it is not part of who may open a Project.
 */
export const projectTags = sqliteTable(
  'project_tags',
  {
    id: id(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull().default(''),
    value: text('value').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check('project_tags_value_check', sql`trim(${table.value}) <> ''`),
    check('project_tags_key_check', sql`${table.key} = trim(${table.key}) AND ${table.key} NOT LIKE '%:%'`),
    uniqueIndex('project_tags_unique').on(table.projectId, table.key, table.value),
  ],
)
