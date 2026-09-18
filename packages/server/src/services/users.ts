// The panel's people.
//
// Every write goes through Better Auth's admin plugin. That is not a style
// choice: creating an account means hashing a password the way sign-in will
// hash it, removing one means cascading through sessions, accounts and api
// keys, and banning one means the library's own checks fire on the next
// request. A second implementation of any of those is a second answer.
//
// Reading is Drizzle, because a listing is one query with the memberships
// joined in, and `listUsers` returns a page of users without them.
//
// What this file adds on top is the part `ac` cannot express: the owner is a
// person, not a permission. Those rules live in `portta-auth-core` as
// `refusalFor*` helpers and are applied here, before the library is called.

import { and, asc, count, eq, inArray } from 'drizzle-orm'
import {
  type Auth,
  type Principal,
  type Role,
  refusalForBan,
  refusalForRemoval,
  refusalForRoleChange,
  refusalForTransfer,
  refusalForUserWrite,
} from 'portta-auth-core'
import type { BanUser, CreateUser, User, UserSession } from 'portta-contracts'
import { type Db, projectMembers, projects as projectsTable, users as usersTable } from 'portta-db'
import { audit } from './audit.ts'

/** A refusal that is a rule, not a permission: 403 with a sentence. */
export class UserRefused extends Error {
  readonly status = 403
  readonly hint: string

  constructor(message: string, hint = 'this is a rule about accounts, not a missing permission') {
    super(message)
    this.name = 'UserRefused'
    this.hint = hint
  }
}

export class UnknownUser extends Error {
  readonly status = 404

  constructor(id: string) {
    super(`no user '${id}'`)
    this.name = 'UnknownUser'
  }
}

/**
 * Open mode has no accounts to administer.
 *
 * Not an empty list: an empty list says "nobody has signed up yet", and the
 * truth is that this panel does not sign anybody in at all.
 */
export class UsersUnavailable extends Error {
  readonly status = 503
  readonly hint = 'set PORTTA_AUTH_MODE=required and open /setup to create the owner'

  constructor() {
    super('this panel does not sign people in, so it has no users')
    this.name = 'UsersUnavailable'
  }
}

export interface UsersDeps {
  db: Db
  auth: Auth | null
}

/**
 * The admin plugin authorises against a session, and only a session.
 *
 * Portta has already decided by the time this runs — the route checked the
 * permission and the rules above checked the rest — but the library will not
 * take that on trust, and asking it to would mean reimplementing what it does.
 * So administering accounts is something a signed-in person does. A machine
 * credential that has been left on a disk for six months is not who should be
 * able to create an administrator.
 */
function sessionHeaders(principal: Principal, headers: Headers): Headers {
  if (principal.sessionId === null) {
    throw new UserRefused(
      'administering accounts needs a signed-in person, not a token',
      'sign in to the panel and do it there',
    )
  }
  return headers
}

function requireAuth(deps: UsersDeps): Auth {
  if (!deps.auth) throw new UsersUnavailable()
  return deps.auth
}

const seconds = (value: Date | null | undefined): number | null => (value ? Math.floor(value.getTime() / 1000) : null)

export class UsersService {
  private readonly db: Db
  private readonly deps: UsersDeps

  constructor(deps: UsersDeps) {
    this.deps = deps
    this.db = deps.db
  }

  /** Every account, with the Projects each one reaches. */
  async list(): Promise<User[]> {
    if (!this.deps.auth) throw new UsersUnavailable()
    const rows = await this.db.select().from(usersTable).orderBy(asc(usersTable.createdAt))
    const memberships = await this.db
      .select({
        userId: projectMembers.userId,
        id: projectsTable.id,
        slug: projectsTable.slug,
        name: projectsTable.name,
      })
      .from(projectMembers)
      .innerJoin(projectsTable, eq(projectsTable.id, projectMembers.projectId))
      .orderBy(asc(projectsTable.name))

    const byUser = new Map<string, User['projects']>()
    for (const row of memberships) {
      const list = byUser.get(row.userId) ?? []
      list.push({ id: row.id, slug: row.slug, name: row.name })
      byUser.set(row.userId, list)
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      banned: row.banned ?? false,
      banReason: row.banReason,
      banExpires: seconds(row.banExpires),
      twoFactorEnabled: row.twoFactorEnabled ?? false,
      createdAt: Math.floor(row.createdAt.getTime() / 1000),
      projects: byUser.get(row.id) ?? [],
    }))
  }

  async find(id: string): Promise<User> {
    const found = (await this.list()).find((user) => user.id === id)
    if (!found) throw new UnknownUser(id)
    return found
  }

  /** The target as the rules need to see it: an id and a role. */
  /**
   * The account a rule is about.
   *
   * The email comes along because the audit line needs it: an entry naming an
   * id nobody can resolve — least of all after the account is removed — is a
   * line that says nothing to whoever reads it.
   */
  private async subject(id: string): Promise<{ id: string; role: Role; email: string }> {
    const [row] = await this.db
      .select({ id: usersTable.id, role: usersTable.role, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, id))
    if (!row) throw new UnknownUser(id)
    return row
  }

  private async ownerCount(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(usersTable).where(eq(usersTable.role, 'owner'))
    return row?.n ?? 0
  }

  async create(principal: Principal, headers: Headers, input: CreateUser): Promise<User> {
    const auth = requireAuth(this.deps)
    // An administrator handing out `owner` would make two of them, and the one
    // thing that keeps an admin from taking the panel is that they cannot.
    if (input.role === 'owner') throw new UserRefused('ownership is transferred, not assigned')

    const created = await auth.api.createUser({
      body: { name: input.name, email: input.email, password: input.password, role: input.role },
      headers: sessionHeaders(principal, headers),
    })
    const id = created.user.id
    if (input.projects?.length) await this.setProjects(principal, id, input.projects)
    await audit(this.db, principal, {
      action: 'user.created',
      resourceType: 'user',
      resourceId: id,
      resourceName: input.email,
      metadata: { role: input.role },
    })
    return this.find(id)
  }

  async setRole(principal: Principal, headers: Headers, id: string, role: Role): Promise<User> {
    const auth = requireAuth(this.deps)
    const target = await this.subject(id)
    const refusal = refusalForRoleChange(principal, target, role)
    if (refusal) throw new UserRefused(refusal)

    await auth.api.setRole({ body: { userId: id, role }, headers: sessionHeaders(principal, headers) })
    // A role that no longer sees every Project keeps no stale memberships, and
    // one that sees everything has no use for them.
    if (role === 'owner' || role === 'admin') {
      await this.db.delete(projectMembers).where(eq(projectMembers.userId, id))
    }
    await audit(this.db, principal, {
      action: 'user.role_changed',
      resourceType: 'user',
      resourceId: id,
      resourceName: target.email,
      metadata: { from: target.role, to: role },
    })
    return this.find(id)
  }

  async setPassword(principal: Principal, headers: Headers, id: string, password: string): Promise<void> {
    const auth = requireAuth(this.deps)
    const target = await this.subject(id)
    const refusal = refusalForUserWrite(principal, target)
    if (refusal) throw new UserRefused(refusal)

    const session = sessionHeaders(principal, headers)
    await auth.api.setUserPassword({ body: { userId: id, newPassword: password }, headers: session })
    // Somebody who knew the old password may still be holding a session with
    // it. Setting a password that leaves those open sets nothing.
    await auth.api.revokeUserSessions({ body: { userId: id }, headers: session })
    // The password itself is not passed on: `audit` would redact it, and the
    // way not to leak a secret is not to hand it to something that redacts.
    await audit(this.db, principal, {
      action: 'user.password_set',
      resourceType: 'user',
      resourceId: id,
      resourceName: target.email,
    })
  }

  async setBan(principal: Principal, headers: Headers, id: string, input: BanUser): Promise<User> {
    const auth = requireAuth(this.deps)
    const target = await this.subject(id)
    const refusal = refusalForBan(principal, target)
    if (refusal) throw new UserRefused(refusal)

    const session = sessionHeaders(principal, headers)
    if (input.banned) {
      await auth.api.banUser({
        body: {
          userId: id,
          ...(input.reason ? { banReason: input.reason } : {}),
          ...(input.days ? { banExpiresIn: input.days * 24 * 60 * 60 } : {}),
        },
        headers: session,
      })
    } else {
      await auth.api.unbanUser({ body: { userId: id }, headers: session })
    }
    await audit(this.db, principal, {
      action: input.banned ? 'user.banned' : 'user.unbanned',
      resourceType: 'user',
      resourceId: id,
      resourceName: target.email,
      metadata: input.banned
        ? { ...(input.reason ? { reason: input.reason } : {}), ...(input.days ? { days: input.days } : {}) }
        : {},
    })
    return this.find(id)
  }

  async remove(principal: Principal, headers: Headers, id: string): Promise<void> {
    const auth = requireAuth(this.deps)
    const target = await this.subject(id)
    const refusal = refusalForRemoval(principal, target, await this.ownerCount())
    if (refusal) throw new UserRefused(refusal)

    // Sessions, accounts, api keys and memberships go with the row: every one
    // of those references it with `on delete cascade`. What survives is the
    // work — a task's `user_id` goes null and its actor name stays readable.
    await auth.api.removeUser({ body: { userId: id }, headers: sessionHeaders(principal, headers) })
    // After the row is gone: the entry's own `user_id` is the caller's, and the
    // account it names survives here as an email because nothing else does.
    await audit(this.db, principal, {
      action: 'user.deleted',
      resourceType: 'user',
      resourceId: id,
      resourceName: target.email,
      metadata: { role: target.role },
    })
  }

  async sessionsOf(principal: Principal, headers: Headers, id: string): Promise<UserSession[]> {
    const auth = requireAuth(this.deps)
    await this.subject(id)
    const found = await auth.api.listUserSessions({
      body: { userId: id },
      headers: sessionHeaders(principal, headers),
    })
    return found.sessions.map((session) => ({
      id: session.id,
      createdAt: Math.floor(new Date(session.createdAt).getTime() / 1000),
      expiresAt: Math.floor(new Date(session.expiresAt).getTime() / 1000),
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
    }))
  }

  async revokeSessions(principal: Principal, headers: Headers, id: string): Promise<void> {
    const auth = requireAuth(this.deps)
    const target = await this.subject(id)
    const refusal = refusalForUserWrite(principal, target)
    if (refusal) throw new UserRefused(refusal)
    await auth.api.revokeUserSessions({ body: { userId: id }, headers: sessionHeaders(principal, headers) })
    await audit(this.db, principal, {
      action: 'user.sessions_revoked',
      resourceType: 'user',
      resourceId: id,
      resourceName: target.email,
    })
  }

  /**
   * Which Projects an account reaches. The whole list, every time.
   *
   * A diff rather than a set of adds and removes, because "these are the
   * Projects" is the sentence a person means, and two clients sending adds and
   * removes at once converge on something neither of them asked for.
   */
  async setProjects(principal: Principal, id: string, wanted: readonly number[]): Promise<User> {
    if (!this.deps.auth) throw new UsersUnavailable()
    const target = await this.subject(id)
    // Owner and admin see everything; a membership row for them would be a
    // restriction that is never read and would mislead whoever found it.
    if (target.role === 'owner' || target.role === 'admin') {
      throw new UserRefused(`${target.role} sees every Project, so membership does not apply`)
    }

    const asked = [...new Set(wanted)]
    const real = asked.length
      ? await this.db.select({ id: projectsTable.id }).from(projectsTable).where(inArray(projectsTable.id, asked))
      : []
    const valid = new Set(real.map((row) => row.id))
    const missing = asked.filter((projectId) => !valid.has(projectId))
    if (missing.length) throw new UserRefused(`no such project: ${missing.join(', ')}`)

    const current = await this.db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, id))
    const held = new Set(current.map((row) => row.projectId))
    const added = [...valid].filter((projectId) => !held.has(projectId))
    const removed = [...held].filter((projectId) => !valid.has(projectId))

    if (added.length) {
      await this.db
        .insert(projectMembers)
        .values(added.map((projectId) => ({ projectId, userId: id, grantedBy: principal.userId })))
    }
    if (removed.length) {
      await this.db
        .delete(projectMembers)
        .where(and(eq(projectMembers.userId, id), inArray(projectMembers.projectId, removed)))
    }
    // One line per Project, not one per call: "who could reach this Project in
    // March" is the question this table is read for, and a single line holding
    // a list of ids answers it only to somebody who reads every line.
    for (const projectId of added) {
      await audit(this.db, principal, {
        action: 'project_access.granted',
        resourceType: 'user',
        resourceId: id,
        resourceName: target.email,
        projectId,
      })
    }
    for (const projectId of removed) {
      await audit(this.db, principal, {
        action: 'project_access.revoked',
        resourceType: 'user',
        resourceId: id,
        resourceName: target.email,
        projectId,
      })
    }
    return this.find(id)
  }

  /**
   * Hand the panel over.
   *
   * One transaction, and the only place `users.role` is written directly. Two
   * `setRole` calls cannot be one transaction, and the state between them is
   * two owners — the one state this panel must never be in, and the one nobody
   * could fix from inside it without the power the second owner just took. The
   * database refuses that state outright now (`users_single_owner`), so this
   * is the ordering that satisfies it rather than the only thing preventing it.
   */
  async transferOwnership(principal: Principal, id: string): Promise<User> {
    if (!this.deps.auth) throw new UsersUnavailable()
    const target = await this.subject(id)
    const refusal = refusalForTransfer(principal, target)
    if (refusal) throw new UserRefused(refusal)
    if (principal.userId === null) throw new UserRefused('only a signed-in owner can transfer ownership')

    const caller = principal.userId
    // Demote first, then promote, and synchronously: `users` has a partial
    // unique index over `role = 'owner'`, so promoting before demoting would
    // violate it rather than briefly producing two owners. Synchronous because
    // an `await` inside a better-sqlite3 transaction resolves after the commit,
    // which would put the second statement outside the atomicity this method
    // exists to provide.
    this.db.transaction((tx) => {
      tx.update(usersTable).set({ role: 'admin', updatedAt: new Date() }).where(eq(usersTable.id, caller)).run()
      tx.update(usersTable).set({ role: 'owner', updatedAt: new Date() }).where(eq(usersTable.id, id)).run()
    })
    // The new owner sees every Project, so their memberships stop meaning
    // anything; leaving them would suggest a boundary that is not enforced.
    await this.db.delete(projectMembers).where(eq(projectMembers.userId, id))
    await audit(this.db, principal, {
      action: 'user.ownership_transferred',
      resourceType: 'user',
      resourceId: id,
      resourceName: target.email,
      metadata: { from: principal.email, to: target.email },
    })
    return this.find(id)
  }
}
