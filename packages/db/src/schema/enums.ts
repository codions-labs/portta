// The vocabularies the database enforces.
//
// Every one of them is built from a constant in portta-core, which is where the
// CLI, the contract and the panel already read it. A value exists once: adding
// a session status means editing one array and generating a migration, never
// editing a list in four places and discovering the fifth in production.
//
// SQLite has no enum type. Drizzle turns `text({ enum })` into a CHECK
// constraint over the same closed set, so the database still refuses a value
// outside it — the guarantee is the same, the DDL is different, and adding a
// value is an `ALTER TABLE` rather than an `ALTER TYPE`.
//
// What is *not* here is deliberate. A repository's `role` stays free text with
// a documented vocabulary, because adding one should not be a migration.

import { ACTIVITY_SOURCES, ACTOR_KINDS, ROLES, SESSION_STATUSES, TASK_PROVIDERS } from 'portta-core'

export const ROLE_VALUES = ROLES
export const SESSION_STATUS_VALUES = SESSION_STATUSES
export const ACTIVITY_SOURCE_VALUES = ACTIVITY_SOURCES

/** Who acted. `system` is the panel itself: a timer, a job, a migration. */
export const ACTOR_KIND_VALUES = ACTOR_KINDS

/**
 * A session is always a person or an agent — never the panel — so the place
 * that means exactly that uses its own narrower vocabulary rather than
 * accepting `system` and refusing it in code.
 */
export const HUMAN_OR_AGENT_VALUES = ['human', 'agent'] as const

/** Why an environment belongs to the project that adopted it. */
export const ADOPTION_SOURCE_VALUES = ['manual', 'label', 'repo-match', 'path'] as const

/** Why an environment is linked to the issue being worked on in it. */
export const ISSUE_ENVIRONMENT_SOURCE_VALUES = ['manual', 'label', 'branch', 'namespace'] as const

/** Which forge a repository's remote belongs to. `local` when there is none. */
export const REPOSITORY_PROVIDER_VALUES = ['local', 'github', 'gitlab', 'bitbucket', 'other'] as const

/** Where a Project's work lives. There is no local mode. */
export const TASK_PROVIDER_VALUES = TASK_PROVIDERS

/** How a principal proved who it was. */
export const PRINCIPAL_KIND_VALUES = ['local', 'user', 'token'] as const
