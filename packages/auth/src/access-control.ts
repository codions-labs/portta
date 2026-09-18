// What a role may do.
//
// One vocabulary, `resource:action`, used by every route, every token scope and
// every setting. The statements are the source: the flat permission names, the
// four roles and the agent default are all derived from them, so adding an
// action is one line here rather than five in five files.
//
// The `user` and `session` resources come from Better Auth's admin plugin: its
// endpoints authorise against exactly those, so they are spread in rather than
// restated. Everything else is Portta's, and an official module adds its own
// resources after the base ones, from the manifests in `portta-core/modules`.

import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { ROLES, type Role as RoleName } from 'portta-core'
import {
  MODULES,
  type ModuleManifest,
  type ModuleStatements,
  modulePermissions,
  moduleRoleGrants,
} from 'portta-core/modules'

const baseStatements = {
  ...defaultStatements,
  project: ['read', 'create', 'update', 'delete', 'members'],
  repository: ['read', 'manage'],
  issue: ['read', 'write'],
  environment: ['read', 'operate', 'destroy', 'settings'],
  service: ['read', 'operate'],
  container: ['read', 'operate', 'destroy', 'console'],
  logs: ['read'],
  metrics: ['read'],
  activity: ['read'],
  worksession: ['read', 'write'],
  /** Bridges, forwarders and shares: the ways into a running environment. */
  access: ['read', 'open', 'manage'],
  gateway: ['read', 'operate'],
  docker: ['read', 'operate', 'destroy'],
  settings: ['read', 'manage'],
  token: ['read', 'create', 'revoke'],
  audit: ['read'],
  ssh: ['read', 'manage'],
} as const

/**
 * The base statements followed by the modules' own.
 *
 * A module resource that reuses a base one would widen what an existing
 * permission means, so it is refused when this file loads. The type is the
 * base object intersected with what the registry adds, which for no modules is
 * the base object alone.
 */
export function withModuleStatements<const M extends readonly ModuleManifest[]>(
  modules: M,
): typeof baseStatements & ModuleStatements<M> {
  const added = modulePermissions(modules)
  for (const resource of Object.keys(added)) {
    if (resource in baseStatements) throw new Error(`a module cannot redefine the ${resource} resource`)
  }
  return { ...baseStatements, ...added } as typeof baseStatements & ModuleStatements<M>
}

export const statements = withModuleStatements(MODULES)

export const ac = createAccessControl(statements)

export type Statements = typeof statements
export type Resource = keyof Statements

/** `issue:write` — the flat form every route, token scope and setting uses. */
export type Permission = {
  [R in Resource]: `${R & string}:${Statements[R][number]}`
}[Resource]

export type Role = RoleName
export { ROLES }

const everything = Object.fromEntries(
  Object.entries(statements).map(([resource, actions]) => [resource, [...actions]]),
) as Record<Resource, string[]>

/**
 * Impersonation is not a feature of this product.
 *
 * The admin plugin offers it; Portta does not, so no role holds it. A panel
 * that can start and stop containers should not also let one person act as
 * another without a trace.
 */
const withoutImpersonation = {
  ...everything,
  user: everything.user.filter((action) => action !== 'impersonate' && action !== 'impersonate-admins'),
}

export const owner = ac.newRole({ ...withoutImpersonation } as never)
/** The difference between `owner` and `admin` is a service rule, not a statement (ADR 0038). */
export const admin = ac.newRole({ ...withoutImpersonation } as never)

export const developer = ac.newRole({
  project: ['read'],
  repository: ['read', 'manage'],
  issue: ['read', 'write'],
  environment: ['read', 'operate', 'settings'],
  service: ['read', 'operate'],
  container: ['read', 'operate'],
  logs: ['read'],
  metrics: ['read'],
  activity: ['read'],
  worksession: ['read', 'write'],
  access: ['read', 'open'],
  gateway: ['read'],
  ssh: ['read'],
  token: ['read', 'create', 'revoke'],
  ...moduleRoleGrants(MODULES, 'developer'),
} as never)

export const viewer = ac.newRole({
  project: ['read'],
  repository: ['read'],
  issue: ['read'],
  environment: ['read'],
  service: ['read'],
  container: ['read'],
  logs: ['read'],
  metrics: ['read'],
  activity: ['read'],
  worksession: ['read'],
  access: ['read'],
  gateway: ['read'],
  ssh: ['read'],
  token: ['read', 'create', 'revoke'],
  ...moduleRoleGrants(MODULES, 'viewer'),
} as never)

export const roles = { owner, admin, developer, viewer } as const

function flatten(granted: Record<string, readonly string[] | undefined>): Permission[] {
  return Object.entries(granted).flatMap(([resource, actions]) =>
    (actions ?? []).map((action) => `${resource}:${action}` as Permission),
  )
}

/** Every permission this installation knows, in statement order. */
export const PERMISSIONS: readonly Permission[] = flatten(statements as never)

const BY_ROLE = new Map<Role, ReadonlySet<Permission>>(
  ROLES.map((role) => [role, new Set(flatten(roles[role].statements as never))]),
)

export function permissionsOf(role: Role): ReadonlySet<Permission> {
  return BY_ROLE.get(role) ?? new Set()
}

/** Everything that only reads. Read-only mode intersects with this. */
export const READ_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((permission) => permission.endsWith(':read'))

/**
 * What an agent holds unless the operator says otherwise.
 *
 * A developer's permissions minus the two that change how the panel itself
 * behaves: an agent works on issues and environments, it does not reconfigure
 * an environment or re-register a repository.
 */
export const AGENT_DEFAULT_PERMISSIONS: readonly Permission[] = [...permissionsOf('developer')].filter(
  (permission) => permission !== 'environment:settings' && permission !== 'repository:manage',
)

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

/**
 * `['issue:read', 'issue:write']` → `{ issue: ['read', 'write'] }`.
 *
 * The apiKey plugin stores scopes in the nested form; every other surface in
 * Portta names them flat, because that is what a route declares and what an
 * operator reads in a list.
 */
export function toStatements(permissions: readonly Permission[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const permission of permissions) {
    const [resource, action] = permission.split(':') as [string, string]
    grouped[resource] ??= []
    grouped[resource].push(action)
  }
  return grouped
}

/** The inverse, for reading a token's stored scopes back. */
export function fromStatements(granted: Record<string, readonly string[]> | null | undefined): Permission[] {
  if (!granted) return []
  return flatten(granted).filter(isPermission)
}
