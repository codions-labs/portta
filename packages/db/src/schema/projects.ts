// The Project: what the operator decided exists.
//
// A Project does not disappear when nothing is running, which is the whole
// point of it being a decision rather than an observation (ADR 0013, ADR 0031).

import { sql } from 'drizzle-orm'
import { check, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAt, flag, id, updatedAt } from './columns.ts'

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    archived: flag('archived').notNull().default(false),
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
