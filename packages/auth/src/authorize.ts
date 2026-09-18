// The one decision, in one function.
//
// A route says which permission it needs; a service says which project the
// resource belongs to. `authorize` answers, and it is the only thing that does
// — a second implementation of this is a second answer to "may I", and one of
// them will be wrong.

import type { ActivitySource } from 'portta-core'
import type { Permission, Role } from './access-control.ts'

export type PrincipalKind = 'local' | 'user' | 'token'

export interface Principal {
  kind: PrincipalKind
  /** Null only for `local`, where there is no account behind the request. */
  userId: string | null
  name: string
  email: string | null
  role: Role
  permissions: ReadonlySet<Permission>
  /** `all` for owner/admin and for `local`; otherwise the ids in project_members. */
  scope: 'all' | ReadonlySet<number>
  /** Attribution: the user's name, a token's declared actor, or X-Portta-Actor. */
  actor: string
  actorKind: 'human' | 'agent'
  source: ActivitySource
  sessionId: string | null
  tokenId: string | null
  /**
   * The address this request appeared to come from, or null.
   *
   * Here rather than threaded through every service signature: the audit log
   * needs it, the audit log is written by services, and a service that had to
   * be handed the request's address would be a service that knows about
   * requests. It is the proxy's claim, like every address behind one, and it is
   * recorded as such — never used to decide anything.
   */
  ip: string | null
}

/** Which project a resource belongs to. Absent means the resource is global. */
export interface Scope {
  /** `null` is an environment no Project adopted: visible only to `scope: 'all'`. */
  projectId?: number | null
}

export class Unauthenticated extends Error {
  readonly status = 401

  constructor(message = 'this request carries no credential') {
    super(message)
    this.name = 'Unauthenticated'
  }
}

export class Forbidden extends Error {
  readonly status = 403
  readonly permission: Permission
  readonly scope: Scope | undefined

  constructor(permission: Permission, scope?: Scope) {
    super(
      scope?.projectId === undefined
        ? `this request needs ${permission}`
        : `this request needs ${permission} on that project`,
    )
    this.name = 'Forbidden'
    this.permission = permission
    this.scope = scope
  }
}

export function can(principal: Principal, permission: Permission, scope?: Scope): boolean {
  if (!principal.permissions.has(permission)) return false
  // A global resource: the permission alone decides.
  if (scope?.projectId === undefined) return true
  if (principal.scope === 'all') return true
  // An environment nothing adopted has no project to be a member of, so only
  // somebody who sees everything sees it.
  if (scope.projectId === null) return false
  return principal.scope.has(scope.projectId)
}

export function authorize(principal: Principal | null, permission: Permission, scope?: Scope): Principal {
  if (!principal) throw new Unauthenticated()
  if (!can(principal, permission, scope)) throw new Forbidden(permission, scope)
  return principal
}

/**
 * Whether a Project is visible at all.
 *
 * Listings filter rather than refuse: a developer asking for the projects sees
 * theirs, not a 403. `authorize` is for reaching a named one.
 */
export function sees(principal: Principal, projectId: number): boolean {
  return principal.scope === 'all' || principal.scope.has(projectId)
}

/**
 * The rules a statement map cannot hold.
 *
 * `ac` answers "may an admin change roles". It cannot answer "may this admin
 * change *this* role", because that depends on who the target is and who is
 * asking — the owner is a person, not a permission. These four are the whole
 * list (ADR 0038), they live beside `authorize` so there is one place to read
 * what protects an account, and each returns the sentence to refuse with or
 * null.
 */
export interface UserSubject {
  id: string
  role: Role
}

/** Nobody changes their own role, and nobody removes themselves. */
function isSelf(principal: Principal, target: UserSubject): boolean {
  return principal.userId !== null && principal.userId === target.id
}

/**
 * Whether this principal may act on this account at all.
 *
 * The owner is the account that cannot be taken from its holder: an admin holds
 * every statement, and the one thing that stops them promoting themselves is
 * that they may not touch the owner.
 */
export function refusalForUserWrite(principal: Principal, target: UserSubject): string | null {
  if (target.role === 'owner' && principal.role !== 'owner') {
    return 'only the owner can act on the owner'
  }
  return null
}

export function refusalForRoleChange(principal: Principal, target: UserSubject, next: Role): string | null {
  if (isSelf(principal, target)) return 'nobody changes their own role'
  const write = refusalForUserWrite(principal, target)
  if (write) return write
  // Ownership moves through `transfer-ownership`, which demotes the caller in
  // the same transaction. Handing the role out any other way makes two owners.
  if (next === 'owner') return 'ownership is transferred, not assigned'
  return null
}

export function refusalForRemoval(principal: Principal, target: UserSubject, owners: number): string | null {
  if (isSelf(principal, target)) return 'nobody removes their own account'
  const write = refusalForUserWrite(principal, target)
  if (write) return write
  // A panel with no owner is a panel nobody can administer. It is legal only
  // before the bootstrap, and getting back there by removing the last one would
  // need somebody with the power to remove them, who no longer exists.
  if (target.role === 'owner' && owners <= 1) return 'the last owner cannot be removed'
  return null
}

export function refusalForBan(principal: Principal, target: UserSubject): string | null {
  if (isSelf(principal, target)) return 'nobody bans their own account'
  return refusalForUserWrite(principal, target)
}

/** Only the owner transfers, and never to themselves. */
export function refusalForTransfer(principal: Principal, target: UserSubject): string | null {
  if (principal.role !== 'owner') return 'only the owner can transfer ownership'
  if (isSelf(principal, target)) return 'the owner already owns this panel'
  return null
}
