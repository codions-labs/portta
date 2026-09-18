'use client'

// Whether to render a control.
//
// Not a security check, and never the only one: the API decides, and it decides
// again on every request. What this is for is not showing somebody a button
// that would answer 403 — the difference between a panel that is read-only for
// you and one that looks broken.
//
// It reads the principal the layout resolved on the server, so the answer is
// there on the first paint. A hook that fetched it would make every control
// appear a moment late, which is worse than one that was never there.

import { usePrincipal } from './principal'

/**
 * `useCan('project:write')` for a global action, `useCan('project:write', projectId)`
 * for one inside a Project. The second argument is what a `developer` is
 * narrowed by: holding the permission is not the same as holding it here.
 */
export function useCan(permission: string, projectId?: string | number | null): boolean {
  const principal = usePrincipal()
  if (!principal.permissions.includes(permission)) return false
  if (projectId === undefined) return true
  if (principal.scope === 'all') return true
  // A resource no Project adopted has no membership to check, so it is for
  // somebody who sees everything and for nobody else.
  if (projectId === null) return false
  return principal.scope.includes(Number(projectId))
}
