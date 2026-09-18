// Where a `Principal` comes from.
//
// This is the only file in the panel that knows how a request proves who it is.
// A route, a service, a page and the event stream all receive a `Principal` and
// never ask what mode the panel is in — which is what keeps
// `if (mode === 'disabled')` out of every other file.

import { eq } from 'drizzle-orm'
import { ACTIVITY_SOURCES, type ActivitySource } from 'portta-core'
import { type Db, projectMembers, users } from 'portta-db'
import {
  AGENT_DEFAULT_PERMISSIONS,
  fromStatements,
  isPermission,
  PERMISSIONS,
  type Permission,
  permissionsOf,
  READ_PERMISSIONS,
  type Role,
} from './access-control.ts'
import type { Auth } from './auth.ts'
import type { Principal } from './authorize.ts'
import type { SecurityConfig } from './security-mode.ts'

export type { Principal } from './authorize.ts'

export interface PrincipalResolver {
  fromHeaders: (headers: Headers) => Promise<Principal | null>
}

/** Whoever runs the panel on their own machine, when it asks for nothing. */
export const LOCAL_PRINCIPAL_NAME = 'local-operator'

const ACTOR = /^[A-Za-z0-9._-]{1,64}$/

/** An actor name is attribution, and it ends up in activity rows and in Traefik logs. */
function readActor(raw: string | null): string | null {
  return raw !== null && ACTOR.test(raw) ? raw : null
}

function readSource(raw: string | null, fallback: ActivitySource): ActivitySource {
  return raw !== null && (ACTIVITY_SOURCES as readonly string[]).includes(raw) ? (raw as ActivitySource) : fallback
}

/**
 * The address a request appeared to come from.
 *
 * `X-Forwarded-For` is the proxy's claim and the panel always sits behind one
 * — Traefik, or the Node server in front of Next. It is recorded in the audit
 * log and used for nothing else, so a spoofed value is a wrong line in a log
 * rather than a decision. The first hop is the client; the rest are proxies.
 */
function readAddress(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  if (first) return first.slice(0, 64)
  return headers.get('x-real-ip')?.trim().slice(0, 64) || null
}

function intersect(
  granted: ReadonlySet<Permission> | readonly Permission[],
  allowed: ReadonlySet<Permission> | readonly Permission[],
): Set<Permission> {
  const second = allowed instanceof Set ? allowed : new Set(allowed)
  const first = granted instanceof Set ? granted : new Set(granted)
  return new Set([...first].filter((permission) => second.has(permission)))
}

export interface ResolverDeps {
  security: SecurityConfig
  db: Db
  /** Absent in `open` mode, where Better Auth is never built. */
  auth?: Auth | null
  /**
   * What an agent holds when the operator has narrowed it, from the
   * `agentPermissions` setting. Absent, or unreadable, means the default.
   */
  agentPermissions?: () => Promise<readonly Permission[]>
}

/** Which Projects this user may see. `owner` and `admin` see all of them. */
async function scopeOf(db: Db, userId: string, role: Role): Promise<'all' | ReadonlySet<number>> {
  if (role === 'owner' || role === 'admin') return 'all'
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
  return new Set(rows.map((row) => row.projectId))
}

export function createPrincipalResolver(deps: ResolverDeps): PrincipalResolver {
  const { security, db } = deps

  /**
   * The local operator.
   *
   * Everything, narrowed twice: by read-only mode, and — when the request
   * declares itself an agent — by whatever the operator granted agents. That
   * second narrowing is the only thing `X-Portta-Actor` decides, and it decides
   * it only here.
   */
  async function localPrincipal(headers: Headers): Promise<Principal> {
    const actor = readActor(headers.get('x-portta-actor'))
    const declaredKind = headers.get('x-portta-actor-kind')
    const actorKind: 'human' | 'agent' = actor !== null && declaredKind !== 'human' ? 'agent' : 'human'

    let permissions: ReadonlySet<Permission> = new Set(PERMISSIONS)
    if (actorKind === 'agent') {
      const granted = (await deps.agentPermissions?.().catch(() => null)) ?? AGENT_DEFAULT_PERMISSIONS
      permissions = intersect(permissions, granted)
    }
    if (security.readOnly) permissions = intersect(permissions, READ_PERMISSIONS)

    return {
      kind: 'local',
      userId: null,
      name: LOCAL_PRINCIPAL_NAME,
      email: null,
      role: 'owner',
      permissions,
      scope: 'all',
      actor: actor ?? 'local',
      actorKind,
      source: readSource(headers.get('x-portta-source'), 'web'),
      sessionId: null,
      tokenId: null,
      ip: readAddress(headers),
    }
  }

  async function fromBearer(headers: Headers): Promise<Principal | null> {
    const authorization = headers.get('authorization')
    if (!authorization?.toLowerCase().startsWith('bearer ')) return null
    const key = authorization.slice(7).trim()
    if (!key.startsWith('ptt_') || !deps.auth) return null

    const verified = await deps.auth.api.verifyApiKey({ body: { key } }).catch(() => null)
    const record = verified?.valid ? verified.key : null
    if (!record) return null

    // The plugin calls the owner `referenceId`; Portta only ever puts a user id
    // there, because a token belongs to a person and inherits their role.
    const [user] = await db.select().from(users).where(eq(users.id, record.referenceId))
    // A banned or removed user's tokens stop working at once, without anybody
    // having to remember to revoke them.
    if (!user || user.banned === true) return null

    const role = user.role as Role
    const scopes = fromStatements(record.permissions as Record<string, string[]> | null)
    // A token never exceeds its owner: the intersection is what makes revoking
    // a role revoke every token that leaned on it.
    const permissions = scopes.length > 0 ? intersect(permissionsOf(role), scopes) : new Set(permissionsOf(role))
    const metadata = (record.metadata ?? {}) as { actor?: string; actorKind?: string; source?: string }

    return {
      kind: 'token',
      userId: user.id,
      name: user.name,
      email: user.email,
      role,
      permissions: security.readOnly ? intersect(permissions, READ_PERMISSIONS) : permissions,
      scope: await scopeOf(db, user.id, role),
      actor: readActor(metadata.actor ?? null) ?? user.name,
      actorKind: metadata.actorKind === 'human' ? 'human' : 'agent',
      source: readSource(headers.get('x-portta-source') ?? metadata.source ?? null, 'api'),
      sessionId: null,
      tokenId: record.id,
      ip: readAddress(headers),
    }
  }

  async function fromCookie(headers: Headers): Promise<Principal | null> {
    if (!deps.auth) return null
    const session = await deps.auth.api.getSession({ headers }).catch(() => null)
    if (!session?.user) return null
    const user = session.user as { id: string; name: string; email: string; role?: string; banned?: boolean }
    if (user.banned === true) return null

    const role = (user.role ?? 'viewer') as Role
    const permissions = permissionsOf(role)

    return {
      kind: 'user',
      userId: user.id,
      name: user.name,
      email: user.email,
      role,
      permissions: security.readOnly ? intersect(permissions, READ_PERMISSIONS) : new Set(permissions),
      scope: await scopeOf(db, user.id, role),
      actor: user.name,
      actorKind: 'human',
      source: readSource(headers.get('x-portta-source'), 'web'),
      sessionId: session.session.id,
      tokenId: null,
      ip: readAddress(headers),
    }
  }

  return {
    async fromHeaders(headers: Headers): Promise<Principal | null> {
      if (security.mode === 'open') return localPrincipal(headers)
      // Bearer first: a CLI or an agent sends one and no cookie, and checking
      // the token is cheaper than a session lookup that will find nothing.
      return (await fromBearer(headers)) ?? (await fromCookie(headers))
    },
  }
}

/** For a test, or for a surface that has already decided. */
export function principalFor(overrides: Partial<Principal> = {}): Principal {
  return {
    kind: 'local',
    userId: null,
    name: LOCAL_PRINCIPAL_NAME,
    email: null,
    role: 'owner',
    permissions: new Set(PERMISSIONS),
    scope: 'all',
    actor: 'local',
    actorKind: 'human',
    source: 'web',
    sessionId: null,
    tokenId: null,
    ip: null,
    ...overrides,
  }
}

export { isPermission }
