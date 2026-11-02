// The vocabularies the database enforces.
//
// Every one of them is built from a constant in portta-core, which is where the
// CLI, the contract and the panel already read it. A value exists once: adding
// a role means editing one array and regenerating the schema, never editing a
// list in four places and discovering the fifth in production.
//
// SQLite has no enum type. Drizzle turns `text({ enum })` into a CHECK
// constraint over the same closed set, so the database still refuses a value
// outside it — the guarantee is the same, the DDL is different, and adding a
// value is an `ALTER TABLE` rather than an `ALTER TYPE`.

import { ROLES } from 'portta-core'

export const ROLE_VALUES = ROLES

/** Why an environment belongs to the project that adopted it. */
export const ADOPTION_SOURCE_VALUES = ['manual', 'label', 'path'] as const

/** How a principal proved who it was. */
export const PRINCIPAL_KIND_VALUES = ['local', 'user', 'token'] as const
