// Who somebody is on this installation.
//
// One role per user, global to the panel: an installation of Portta is one
// installation, so there is no organisation to scope a role to. Where a role
// applies is a separate question, answered by project membership.
//
// The order is the order of authority, and code depends on it: `owner` first,
// `viewer` last. `packages/db` builds its enum from this list and
// `packages/auth` builds its access-control roles from it, so a role exists
// once.

export const ROLES = ['owner', 'admin', 'developer', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/** Whether a value is a role this installation knows. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
