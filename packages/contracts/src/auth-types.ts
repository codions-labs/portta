// Who the panel's users are, as the API returns them.
//
// A user never crosses this boundary with anything that authenticates them: no
// hash, no session token, no api-key secret. What a caller gets is a name, a
// role, whether the account is usable, and which Projects it reaches.

import { AUDIT_ACTIONS, ROLES } from 'portta-core/browser'
import { z } from 'zod'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const Role = named(z.enum(ROLES).describe('What this account may do, everywhere'), 'Role')
export type Role = z.infer<typeof Role>

export const User = named(
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: Role,
      /** A banned account keeps its rows and stops working on its next request. */
      banned: z.boolean(),
      banReason: z.string().nullable(),
      banExpires: unixSeconds.nullable(),
      twoFactorEnabled: z.boolean(),
      createdAt: unixSeconds,
      /** The Projects this account reaches. Empty and meaningless for owner and admin, who see everything. */
      projects: z.array(z.object({ id: z.number(), slug: z.string(), name: z.string() }).strict()),
    })
    .strict(),
  'User',
)
export type User = z.infer<typeof User>

export const Users = named(z.object({ users: z.array(User) }).strict(), 'Users')
export type Users = z.infer<typeof Users>

export const CreateUser = named(
  z
    .object({
      name: z.string().min(1).max(120),
      email: z.email(),
      password: z.string().min(10).max(128),
      role: Role.default('viewer'),
      /** Project ids this account starts with. Ignored for owner and admin. */
      projects: z.array(z.number().int().positive()).max(200).optional(),
    })
    .strict(),
  'CreateUser',
)
export type CreateUser = z.infer<typeof CreateUser>

export const SetRole = named(z.object({ role: Role }).strict(), 'SetRole')
export type SetRole = z.infer<typeof SetRole>

export const SetPassword = named(z.object({ password: z.string().min(10).max(128) }).strict(), 'SetPassword')
export type SetPassword = z.infer<typeof SetPassword>

export const BanUser = named(
  z
    .object({
      banned: z.boolean(),
      reason: z.string().max(500).optional(),
      /** Days from now. Absent means until somebody lifts it. */
      days: z.number().int().min(1).max(3650).optional(),
    })
    .strict(),
  'BanUser',
)
export type BanUser = z.infer<typeof BanUser>

export const SetUserProjects = named(
  z.object({ projects: z.array(z.number().int().positive()).max(200) }).strict(),
  'SetUserProjects',
)
export type SetUserProjects = z.infer<typeof SetUserProjects>

/** One open session of a user, so somebody can see and end it. */
export const UserSession = named(
  z
    .object({
      id: z.string(),
      createdAt: unixSeconds,
      expiresAt: unixSeconds,
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
    })
    .strict(),
  'UserSession',
)
export type UserSession = z.infer<typeof UserSession>

export const UserSessions = named(z.object({ sessions: z.array(UserSession) }).strict(), 'UserSessions')
export type UserSessions = z.infer<typeof UserSessions>

export const ApiToken = named(
  z
    .object({
      id: z.string(),
      name: z.string(),
      /** The first characters. Enough to recognise one, useless to anybody else. */
      start: z.string().nullable(),
      actor: z.string(),
      actorKind: z.enum(['human', 'agent']),
      scopes: z.array(z.string()),
      createdAt: unixSeconds,
      expiresAt: unixSeconds.nullable(),
      lastUsedAt: unixSeconds.nullable(),
      enabled: z.boolean(),
      /** Whose it is. Present so an administrator's listing is readable. */
      user: z.string(),
    })
    .strict(),
  'ApiToken',
)
export type ApiToken = z.infer<typeof ApiToken>

export const ApiTokens = named(z.object({ tokens: z.array(ApiToken) }).strict(), 'ApiTokens')
export type ApiTokens = z.infer<typeof ApiTokens>

export const CreateApiToken = named(
  z
    .object({
      name: z.string().min(1).max(80),
      actorKind: z.enum(['human', 'agent']).default('agent'),
      /** Absent means the default for the kind, narrowed by the owner's role. */
      scopes: z.array(z.string()).max(200).optional(),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    })
    .strict(),
  'CreateApiToken',
)
export type CreateApiToken = z.infer<typeof CreateApiToken>

export const CreatedApiToken = named(
  z
    .object({
      token: z.string().describe('The secret. Shown here and nowhere else, ever.'),
      credential: ApiToken,
    })
    .strict(),
  'CreatedApiToken',
)
export type CreatedApiToken = z.infer<typeof CreatedApiToken>

export const AuditEntry = named(
  z
    .object({
      id: z.string(),
      at: unixSeconds,
      userId: z.string().nullable(),
      userEmail: z.string().nullable(),
      principalKind: z.enum(['local', 'user', 'token']),
      actor: z.string(),
      action: z.enum(AUDIT_ACTIONS),
      resourceType: z.string(),
      resourceId: z.string().nullable(),
      resourceName: z.string().nullable(),
      project: z.string().nullable().describe('Project slug, when the entry is about one'),
      ipAddress: z.string().nullable(),
      /** Never a request body, a password, a hash, a token or an environment variable. */
      metadata: z.record(z.string(), z.unknown()),
    })
    .strict(),
  'AuditEntry',
)
export type AuditEntry = z.infer<typeof AuditEntry>

export const AuditPage = named(
  z
    .object({
      entries: z.array(AuditEntry),
      nextBefore: z.string().nullable().describe('Pass as ?before= for the next page'),
    })
    .strict(),
  'AuditPage',
)
export type AuditPage = z.infer<typeof AuditPage>

/**
 * What a local agent may do, and what it could do.
 *
 * An agent announces itself with `X-Portta-Actor`; this is the ceiling the
 * panel puts over it. `available` comes from the installation rather than from
 * a list the browser keeps, so a panel that learns a new permission offers it
 * without the page being rebuilt.
 */
export const AgentPermissions = named(
  z
    .object({
      permissions: z.array(z.string()).describe('In force right now'),
      defaults: z.array(z.string()).describe('What an agent holds when nothing is set'),
      available: z.array(z.string()).describe('Every permission this installation knows'),
      configured: z.boolean().describe('False when the default is what is in force'),
    })
    .strict(),
  'AgentPermissions',
)
export type AgentPermissions = z.infer<typeof AgentPermissions>

export const SetAgentPermissions = named(
  z
    .object({
      permissions: z.array(z.string().min(1).max(64)).max(64).nullable().describe('Null restores the default'),
    })
    .strict(),
  'SetAgentPermissions',
)
export type SetAgentPermissions = z.infer<typeof SetAgentPermissions>
