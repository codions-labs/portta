// The tables Better Auth owns.
//
// Shapes are dictated by the library, not chosen here: the adapter runs with
// `usePlural: true`, so `user` is `users`, `session` is `sessions`, and the
// api-key model maps to `api_keys`. Columns the plugins require exist even when
// the panel never writes them (`impersonated_by` is the clearest example);
// dropping one makes the plugin's own queries fail at runtime rather than here.
//
// Ids are `text` holding a nanoid because that is what Better Auth generates
// and compares. Domain ids stay integer rowids — see projects.ts.

import { relations, sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { nanoid } from 'nanoid'
import { createdAt, flag, moment, updatedAt, vocabulary, vocabularyCheck } from './columns.ts'
import { ROLE_VALUES } from './enums.ts'

/** Every auth table's id, so the generator lives in one place. */
const authId = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid())

export const users = sqliteTable(
  'users',
  {
    id: authId(),
    name: text('name').notNull(),
    /** Better Auth normalises this to lower case before it reaches the row. */
    email: text('email').notNull().unique(),
    /** Never required to sign in: this is a self-hosted panel with no mail transport. */
    emailVerified: flag('email_verified').notNull().default(false),
    image: text('image'),
    /**
     * The admin plugin's column. Exactly one user is `owner`, and that is now
     * the database's invariant rather than a service rule — see the partial
     * unique index below.
     */
    role: vocabulary('role', ROLE_VALUES).notNull().default('viewer'),
    banned: flag('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: moment('ban_expires'),
    twoFactorEnabled: flag('two_factor_enabled').default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    vocabularyCheck('users', table.role, ROLE_VALUES),
    index('users_role_idx').on(table.role),
    /**
     * At most one owner, enforced here rather than in the bootstrap.
     *
     * SQLite has no advisory lock, and its transactions are synchronous — an
     * `await` inside one runs after the commit — so a check-then-insert in the
     * setup route would not be a lock at all. A partial unique index is: two
     * people opening `/setup` at the same moment produce one owner and one
     * constraint violation, which the route reports as "already has an owner".
     *
     * Partial, because a database legitimately has no owner between creation
     * and the bootstrap, and every other role is held by many people.
     */
    uniqueIndex('users_single_owner').on(table.role).where(sql`${table.role} = 'owner'`),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: authId(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: moment('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Required by the admin plugin. Portta never impersonates, so it stays null. */
    impersonatedBy: text('impersonated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
)

export const accounts = sqliteTable(
  'accounts',
  {
    id: authId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Who vouches for this identity.
     *
     * Better Auth 1.7 scopes an account by issuer as well as by id, so two
     * providers can name the same account without colliding. Portta configures
     * one provider and nothing else, but the column is required and the library
     * queries it: leaving it out makes every sign-in fail at the adapter.
     */
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    /** `credential` for a password. No social provider is configured. */
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: moment('access_token_expires_at'),
    refreshTokenExpiresAt: moment('refresh_token_expires_at'),
    scope: text('scope'),
    /** A scrypt hash. Never returned by any route, never logged. */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('accounts_user_idx').on(table.userId),
    uniqueIndex('accounts_issuer_account_id_idx').on(table.issuer, table.accountId),
  ],
)

export const verifications = sqliteTable('verifications', {
  id: authId(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: moment('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * Personal API tokens, from the `apiKey` plugin. `key` is a hash; the secret
 * itself is shown once, at creation, and is never recoverable from a row.
 */
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: authId(),
    /**
     * Which set of api-key options minted this token.
     *
     * The plugin supports several named configurations; Portta declares one, so
     * every row says `default`. The column is required by the library and read
     * on every verification, so it exists even though nothing here varies it.
     */
    configId: text('config_id').notNull().default('default'),
    name: text('name'),
    /** The first characters, so a listing can identify a token without the secret. */
    start: text('start'),
    prefix: text('prefix'),
    key: text('key').notNull(),
    referenceId: text('reference_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: flag('enabled').default(true),
    expiresAt: moment('expires_at'),
    lastRequest: moment('last_request'),
    requestCount: integer('request_count').default(0),
    remaining: integer('remaining'),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: moment('last_refill_at'),
    rateLimitEnabled: flag('rate_limit_enabled').default(false),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    /** `{ resource: [actions] }`, as the plugin stores it: text, not json. */
    permissions: text('permissions'),
    /** `{ actor, actorKind, source }`. Never a secret. */
    metadata: text('metadata'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('api_keys_reference_idx').on(table.referenceId)],
)

export const twoFactors = sqliteTable('two_factors', {
  id: authId(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  verified: flag('verified').default(false),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: moment('locked_until'),
})

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  apiKeys: many(apiKeys),
  twoFactors: many(twoFactors),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.referenceId], references: [users.id] }),
}))

export const twoFactorsRelations = relations(twoFactors, ({ one }) => ({
  user: one(users, { fields: [twoFactors.userId], references: [users.id] }),
}))
