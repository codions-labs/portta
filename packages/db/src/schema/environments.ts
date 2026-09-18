// What this host has been observed running, the overrides on it, and the issue
// it is being worked on.
//
// An Environment is identity plus a cache of where it was last seen. It is
// never deleted because a container vanished; only an explicit removal forgets
// it (ADR 0013, ADR 0031).

import { relations, sql } from 'drizzle-orm'
import { check, index, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAt, id, json, ref, updatedAt, vocabulary, vocabularyCheck } from './columns.ts'
import { ADOPTION_SOURCE_VALUES, ISSUE_ENVIRONMENT_SOURCE_VALUES } from './enums.ts'
import { projects } from './projects.ts'

export const environments = sqliteTable(
  'environments',
  {
    id: id(),
    composeProject: text('compose_project').notNull().unique(),
    /** Where Compose ran, as the daemon last recorded it. */
    workingDir: text('working_dir'),
    /**
     * Which files Compose read. With these and `working_dir`, an environment
     * whose containers are gone can be started again through the runner with no
     * container to read labels from (ADR 0030). Empty means never observed.
     *
     * A JSON array: SQLite has no array type, and the column is read whole
     * every time — nothing queries inside it.
     */
    configFiles: json<string[]>('config_files').notNull().default(sql`('[]')`),
    repoUrl: text('repo_url'),
    repoSubpath: text('repo_subpath'),
    firstSeenAt: createdAt('first_seen_at'),
    lastSeenAt: createdAt('last_seen_at'),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('environments_compose_project_check', sql`trim(${table.composeProject}) <> ''`),
    index('environments_last_seen_idx').on(table.lastSeenAt),
    index('environments_repo_coordinate_idx')
      .on(table.repoUrl, table.repoSubpath)
      .where(sql`${table.repoUrl} IS NOT NULL`),
  ],
)

/**
 * Which Project adopted which Environment, and why. `source` records the reason
 * so the panel can explain an adoption rather than merely present it.
 */
export const projectEnvironments = sqliteTable(
  'project_environments',
  {
    projectId: ref('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: ref('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    source: vocabulary('source', ADOPTION_SOURCE_VALUES).notNull(),
  },
  (table) => [
    vocabularyCheck('project_environments', table.source, ADOPTION_SOURCE_VALUES),
    primaryKey({ columns: [table.projectId, table.environmentId] }),
    // An environment belongs to at most one Project: two Projects claiming one
    // running environment would make "which product is this" unanswerable.
    uniqueIndex('project_environments_one_project_per_env').on(table.environmentId),
  ],
)

/**
 * Which issue an environment is being worked on, and how Portta knows.
 *
 * This is what is left of the old `task_environments` once Portta stopped
 * owning a task: the link is real Portta functionality — "what is this running
 * for" — but the thing on the other end is now an issue in GitHub or Linear,
 * named by a ref rather than by a row.
 *
 * The environment is the primary key, not half of a pair: one environment is
 * being worked on for at most one issue, so the question has one answer. The
 * same issue may have several environments.
 */
export const environmentIssues = sqliteTable(
  'environment_issues',
  {
    environmentId: ref('environment_id')
      .primaryKey()
      .references(() => environments.id, { onDelete: 'cascade' }),
    /** `github:owner/repo#113` or `linear:ENG-42`. Never a database id. */
    issueRef: text('issue_ref').notNull(),
    source: vocabulary('source', ISSUE_ENVIRONMENT_SOURCE_VALUES).notNull(),
    branch: text('branch'),
    linkedAt: createdAt('linked_at'),
  },
  (table) => [
    vocabularyCheck('environment_issues', table.source, ISSUE_ENVIRONMENT_SOURCE_VALUES),
    check('environment_issues_ref_check', sql`trim(${table.issueRef}) <> '' AND instr(${table.issueRef}, ':') > 1`),
    index('environment_issues_ref_idx').on(table.issueRef),
  ],
)

export const environmentSettings = sqliteTable(
  'environment_settings',
  {
    environmentId: ref('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: json<unknown>('value').notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.environmentId, table.key] }),
    check('environment_settings_key_check', sql`trim(${table.key}) <> ''`),
  ],
)

export const serviceSettings = sqliteTable(
  'service_settings',
  {
    environmentId: ref('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    service: text('service').notNull(),
    key: text('key').notNull(),
    value: json<unknown>('value').notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.environmentId, table.service, table.key] }),
    check('service_settings_service_check', sql`trim(${table.service}) <> ''`),
    check('service_settings_key_check', sql`trim(${table.key}) <> ''`),
  ],
)

export const environmentsRelations = relations(environments, ({ many, one }) => ({
  projectLinks: many(projectEnvironments),
  settings: many(environmentSettings),
  serviceSettings: many(serviceSettings),
  issue: one(environmentIssues, { fields: [environments.id], references: [environmentIssues.environmentId] }),
}))

export const projectEnvironmentsRelations = relations(projectEnvironments, ({ one }) => ({
  project: one(projects, { fields: [projectEnvironments.projectId], references: [projects.id] }),
  environment: one(environments, {
    fields: [projectEnvironments.environmentId],
    references: [environments.id],
  }),
}))

export const environmentIssuesRelations = relations(environmentIssues, ({ one }) => ({
  environment: one(environments, {
    fields: [environmentIssues.environmentId],
    references: [environments.id],
  }),
}))

export const environmentSettingsRelations = relations(environmentSettings, ({ one }) => ({
  environment: one(environments, {
    fields: [environmentSettings.environmentId],
    references: [environments.id],
  }),
}))

export const serviceSettingsRelations = relations(serviceSettings, ({ one }) => ({
  environment: one(environments, {
    fields: [serviceSettings.environmentId],
    references: [environments.id],
  }),
}))
