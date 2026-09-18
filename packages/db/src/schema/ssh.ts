// SSH credentials owned by this Portta instance.
//
// Only public material and metadata live in the database. The private key is
// deliberately represented by neither a column nor a nullable placeholder: it
// lives in the instance-scoped state/ssh directory and cannot accidentally be
// selected into an API response.

import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { createdAt } from './columns.ts'
import { instance } from './instance.ts'

export const sshKeys = sqliteTable(
  'ssh_keys',
  {
    id: text('id').primaryKey(),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instance.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    algorithm: text('algorithm').notNull(),
    bits: integer('bits'),
    fingerprint: text('fingerprint').notNull(),
    publicKey: text('public_key').notNull(),
    origin: text('origin').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('ssh_keys_instance_name_unique').on(table.instanceId, table.name),
    check('ssh_keys_name_check', sql`trim(${table.name}) <> ''`),
    check('ssh_keys_algorithm_check', sql`${table.algorithm} IN ('ed25519', 'rsa')`),
    check('ssh_keys_bits_check', sql`${table.bits} IS NULL OR ${table.bits} >= 2048`),
    check('ssh_keys_origin_check', sql`${table.origin} IN ('generated', 'imported')`),
    check('ssh_keys_fingerprint_check', sql`trim(${table.fingerprint}) <> ''`),
    check('ssh_keys_public_key_check', sql`trim(${table.publicKey}) <> ''`),
  ],
)
