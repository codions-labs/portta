// The matrix: four roles against every permission, and the scope on top of it.
//
// This is the file that would catch a role quietly gaining something. It walks
// the whole permission list rather than naming a few, so a permission added
// tomorrow is decided today.

import { describe, expect, it } from 'vitest'
import {
  AGENT_DEFAULT_PERMISSIONS,
  authorize,
  can,
  Forbidden,
  PERMISSIONS,
  type Permission,
  permissionsOf,
  principalFor,
  READ_PERMISSIONS,
  ROLES,
  type Role,
  refusalForBan,
  refusalForRemoval,
  refusalForRoleChange,
  refusalForTransfer,
  refusalForUserWrite,
  sees,
  Unauthenticated,
} from '../src/index.ts'

function principal(role: Role, scope: 'all' | ReadonlySet<number> = 'all') {
  return principalFor({ kind: 'user', role, permissions: permissionsOf(role), scope, userId: 'u1' })
}

describe('the role matrix', () => {
  it('gives owner and admin everything except impersonation', () => {
    for (const role of ['owner', 'admin'] as const) {
      const granted = permissionsOf(role)
      for (const permission of PERMISSIONS) {
        const impersonation = permission.startsWith('user:impersonate')
        expect(granted.has(permission), `${role} ${permission}`).toBe(!impersonation)
      }
    }
  })

  it('lets a developer work but not administer', () => {
    const granted = permissionsOf('developer')
    for (const allowed of ['issue:write', 'environment:operate', 'logs:read', 'access:open', 'worksession:write']) {
      expect(granted.has(allowed as Permission), allowed).toBe(true)
    }
    for (const refused of [
      'settings:manage',
      'user:create',
      'user:delete',
      'environment:destroy',
      'container:destroy',
      'docker:destroy',
      'project:delete',
      'project:create',
      'audit:read',
      'access:manage',
      'gateway:operate',
    ]) {
      expect(granted.has(refused as Permission), refused).toBe(false)
    }
  })

  // The log says who did what to accounts, tokens and settings; a developer
  // reading it would be reading an administrative record of their colleagues.
  it('keeps the audit log to the two roles that administer the panel', () => {
    expect(permissionsOf('owner').has('audit:read')).toBe(true)
    expect(permissionsOf('admin').has('audit:read')).toBe(true)
    expect(permissionsOf('developer').has('audit:read')).toBe(false)
    expect(permissionsOf('viewer').has('audit:read')).toBe(false)
  })

  it('gives a viewer only reads, and the tokens that are their own', () => {
    const granted = permissionsOf('viewer')
    for (const permission of granted) {
      const isRead = (READ_PERMISSIONS as readonly string[]).includes(permission)
      const isOwnToken = permission.startsWith('token:')
      expect(isRead || isOwnToken, permission).toBe(true)
    }
  })

  it('never grants a permission nothing declares', () => {
    for (const role of ROLES) {
      for (const permission of permissionsOf(role)) {
        expect(PERMISSIONS, `${role} ${permission}`).toContain(permission)
      }
    }
  })
})

describe('what an agent holds by default', () => {
  // An agent works on issues and environments. It does not reconfigure an
  // environment or re-register a repository — those change how the panel
  // behaves, not what the work is.
  it('is a developer minus the two that change the panel', () => {
    const developer = permissionsOf('developer')
    const agent = new Set(AGENT_DEFAULT_PERMISSIONS)
    for (const permission of developer) {
      const withheld = permission === 'environment:settings' || permission === 'repository:manage'
      expect(agent.has(permission), permission).toBe(!withheld)
    }
  })
})

describe('the scope on top of the permission', () => {
  const alpha = 1
  const beta = 2

  it('lets a developer who is a member through', () => {
    const developer = principal('developer', new Set([alpha]))
    expect(can(developer, 'issue:write', { projectId: alpha })).toBe(true)
  })

  it('refuses a developer who is not, even holding the permission', () => {
    const developer = principal('developer', new Set([alpha]))
    expect(developer.permissions.has('issue:write')).toBe(true)
    expect(can(developer, 'issue:write', { projectId: beta })).toBe(false)
  })

  // An environment no Project adopted has no membership to check, so it is
  // visible only to somebody who sees everything.
  it('refuses an unadopted environment to anyone scoped', () => {
    expect(can(principal('developer', new Set([alpha])), 'environment:read', { projectId: null })).toBe(false)
    expect(can(principal('admin'), 'environment:read', { projectId: null })).toBe(true)
  })

  it('lets owner and admin through every project', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(can(principal(role), 'issue:write', { projectId: beta })).toBe(true)
    }
  })

  it('ignores the scope for a resource that has none', () => {
    expect(can(principal('developer', new Set()), 'metrics:read')).toBe(true)
  })

  it('lets every role read SSH metadata and reserves key mutations for administrators', () => {
    for (const role of ['owner', 'admin', 'developer', 'viewer'] as const) {
      expect(can(principal(role), 'ssh:read')).toBe(true)
    }
    expect(can(principal('owner'), 'ssh:manage')).toBe(true)
    expect(can(principal('admin'), 'ssh:manage')).toBe(true)
    expect(can(principal('developer'), 'ssh:manage')).toBe(false)
    expect(can(principal('viewer'), 'ssh:manage')).toBe(false)
  })

  it('keeps a container console distinct from lifecycle operations', () => {
    expect(can(principal('owner'), 'container:console')).toBe(true)
    expect(can(principal('admin'), 'container:console')).toBe(true)
    expect(can(principal('developer'), 'container:operate')).toBe(true)
    expect(can(principal('developer'), 'container:console')).toBe(false)
    expect(can(principal('viewer'), 'container:console')).toBe(false)
    expect(AGENT_DEFAULT_PERMISSIONS).not.toContain('container:console')
  })
})

describe('what authorize throws', () => {
  it('is 401 with no principal at all', () => {
    expect(() => authorize(null, 'issue:read')).toThrow(Unauthenticated)
    try {
      authorize(null, 'issue:read')
    } catch (error) {
      expect((error as Unauthenticated).status).toBe(401)
    }
  })

  // The distinction is the point: 401 means "say who you are", 403 means "you
  // did, and it is not enough". A client that cannot tell them apart retries
  // forever.
  it('is 403 for a principal that is not allowed, and names what was needed', () => {
    const viewer = principal('viewer')
    expect(() => authorize(viewer, 'issue:write')).toThrow(Forbidden)
    try {
      authorize(viewer, 'issue:write')
    } catch (error) {
      expect((error as Forbidden).status).toBe(403)
      expect((error as Forbidden).permission).toBe('issue:write')
      expect((error as Error).message).toContain('issue:write')
    }
  })

  it('returns the principal when it passes, so a handler can use it', () => {
    const owner = principal('owner')
    expect(authorize(owner, 'issue:write')).toBe(owner)
  })
})

describe('listing versus reaching', () => {
  // A listing filters; only a named resource refuses. A developer asking for
  // the projects sees theirs, not a 403.
  it('says which projects are visible without deciding a permission', () => {
    const developer = principal('developer', new Set([1]))
    expect(sees(developer, 1)).toBe(true)
    expect(sees(developer, 2)).toBe(false)
    expect(sees(principal('admin'), 2)).toBe(true)
  })
})

describe('the rules a statement map cannot hold', () => {
  const owner = { id: 'u-owner', role: 'owner' as const }
  const admin = { id: 'u-admin', role: 'admin' as const }
  const dev = { id: 'u-dev', role: 'developer' as const }

  const asOwner = principalFor({
    kind: 'user',
    role: 'owner',
    permissions: permissionsOf('owner'),
    scope: 'all',
    userId: 'u-owner',
  })
  const asAdmin = principalFor({
    kind: 'user',
    role: 'admin',
    permissions: permissionsOf('admin'),
    scope: 'all',
    userId: 'u-admin',
  })

  it('lets nobody change their own role, whoever they are', () => {
    expect(refusalForRoleChange(asOwner, owner, 'admin')).toMatch(/their own role/)
    expect(refusalForRoleChange(asAdmin, admin, 'viewer')).toMatch(/their own role/)
  })

  // An admin holds every statement the owner does. This is the whole difference
  // between them, and it is why an admin cannot promote themselves.
  it('keeps every write on the owner to the owner', () => {
    expect(refusalForUserWrite(asAdmin, owner)).toMatch(/only the owner/)
    expect(refusalForBan(asAdmin, owner)).toMatch(/only the owner/)
    expect(refusalForRemoval(asAdmin, owner, 2)).toMatch(/only the owner/)
    expect(refusalForUserWrite(asOwner, admin)).toBeNull()
  })

  it('never hands `owner` out through a role change', () => {
    expect(refusalForRoleChange(asOwner, admin, 'owner')).toMatch(/transferred/)
    expect(refusalForRoleChange(asOwner, admin, 'viewer')).toBeNull()
  })

  // A panel with no owner is a panel nobody can administer, and getting back
  // there would need the power of the person being removed.
  it('keeps the last owner', () => {
    expect(refusalForRemoval(asOwner, { id: 'u-other', role: 'owner' }, 1)).toMatch(/last owner/)
    expect(refusalForRemoval(asOwner, { id: 'u-other', role: 'owner' }, 2)).toBeNull()
    expect(refusalForRemoval(asOwner, dev, 1)).toBeNull()
  })

  it('lets nobody remove or ban themselves', () => {
    expect(refusalForRemoval(asAdmin, admin, 2)).toMatch(/their own account/)
    expect(refusalForBan(asAdmin, admin)).toMatch(/their own account/)
  })

  it('gives the transfer to the owner alone, and never to themselves', () => {
    expect(refusalForTransfer(asAdmin, dev)).toMatch(/only the owner/)
    expect(refusalForTransfer(asOwner, owner)).toMatch(/already owns/)
    expect(refusalForTransfer(asOwner, dev)).toBeNull()
  })
})
