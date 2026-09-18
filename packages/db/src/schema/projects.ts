// The Project — what the operator decided exists — and its repositories.
//
// A Project does not disappear when nothing is running, which is the whole
// point of it being a decision rather than an observation (ADR 0013, ADR 0031).

import { relations, sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAt, flag, id, ref, updatedAt, vocabulary, vocabularyCheck } from './columns.ts'
import { REPOSITORY_PROVIDER_VALUES, TASK_PROVIDER_VALUES } from './enums.ts'

export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    archived: flag('archived').notNull().default(false),
    /**
     * Where this Project's work lives.
     *
     * Null is not a third mode: it means "not chosen", and the panel derives
     * `github` from the repository's own remote. A row exists only when the
     * operator picked Linear, or picked GitHub for a Project whose remote is
     * somewhere else
     * (docs/development/adr/0050-work-lives-in-an-external-provider.md).
     */
    taskProvider: vocabulary('task_provider', TASK_PROVIDER_VALUES),
    /**
     * The Linear team this Project's issues belong to, such as `ENG`.
     *
     * Beside the provider rather than in `settings`, because "which provider"
     * and "which team" are one decision: a Project on Linear with no team names
     * nothing, and splitting the two across a column and a stringly-keyed
     * setting would let them disagree. GitHub needs no equivalent — its
     * coordinate is already the repository's remote.
     */
    linearTeam: text('linear_team'),
    /**
     * The first-level directory under Projects Home (`storefront`), never an
     * absolute path and never the identity: changing PORTTA_PROJECTS_HOME must
     * not invent new Projects (ADR 0031).
     */
    relativePath: text('relative_path'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    vocabularyCheck('projects', table.taskProvider, TASK_PROVIDER_VALUES),
    check('projects_slug_check', sql`trim(${table.slug}) <> ''`),
    check(
      'projects_linear_team_check',
      sql`${table.linearTeam} IS NULL OR (${table.linearTeam} GLOB '[A-Z]*' AND length(${table.linearTeam}) BETWEEN 1 AND 10)`,
    ),
    check('projects_name_check', sql`trim(${table.name}) <> ''`),
    check(
      'projects_relative_path_check',
      sql`${table.relativePath} IS NULL OR (trim(${table.relativePath}) <> '' AND ${table.relativePath} NOT LIKE '/%' AND ${table.relativePath} NOT LIKE '%..%' AND ${table.relativePath} NOT LIKE '%/%')`,
    ),
    uniqueIndex('projects_relative_path_unique').on(table.relativePath).where(sql`${table.relativePath} IS NOT NULL`),
  ],
)

/**
 * A Project's code. It exists without GitHub: a local clone with no remote is a
 * Repository, and `remote_url` is what says where it came from.
 *
 * Nothing about the forge is projected into a row. Portta reads Issues through
 * `gh` at request time and stores no copy of them
 * (docs/development/adr/0018-github-issues-through-the-gh-cli.md), so the
 * remote is the whole link: `owner/name` is parsed from it when a call needs it.
 *
 * What the host scan observed (branch, commits, instruction files) is read from
 * state/git at request time and never stored here.
 */
export const repositories = sqliteTable(
  'repositories',
  {
    id: id(),
    projectId: ref('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Free text with a documented vocabulary, so adding one is not a migration. */
    role: text('role'),
    localPath: text('local_path'),
    relativePath: text('relative_path'),
    remoteUrl: text('remote_url'),
    provider: vocabulary('provider', REPOSITORY_PROVIDER_VALUES).notNull().default('local'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    vocabularyCheck('repositories', table.provider, REPOSITORY_PROVIDER_VALUES),
    unique('repositories_project_id_name_key').on(table.projectId, table.name),
    check('repositories_name_check', sql`trim(${table.name}) <> ''`),
    check(
      'repositories_local_path_check',
      sql`${table.localPath} IS NULL OR (${table.localPath} LIKE '/%' AND ${table.localPath} NOT LIKE '%/../%' AND ${table.localPath} NOT LIKE '%/..')`,
    ),
    check(
      'repositories_relative_path_check',
      sql`${table.relativePath} IS NULL OR (trim(${table.relativePath}) <> '' AND ${table.relativePath} NOT LIKE '/%' AND ${table.relativePath} NOT LIKE '%..%')`,
    ),
    uniqueIndex('repositories_local_path_unique').on(table.localPath).where(sql`${table.localPath} IS NOT NULL`),
    index('repositories_project_idx').on(table.projectId, table.position),
  ],
)

export const projectsRelations = relations(projects, ({ many }) => ({
  repositories: many(repositories),
}))

export const repositoriesRelations = relations(repositories, ({ one }) => ({
  project: one(projects, { fields: [repositories.projectId], references: [projects.id] }),
}))
