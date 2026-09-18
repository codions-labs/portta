// The principal, as the browser may see it.
//
// A `Principal` carries a `Set` and, in protected mode, a session id. Neither
// belongs in the HTML: a Set does not survive serialisation, and a session id
// in the page is a credential in the page. This is the projection that crosses
// the boundary — names and permissions, nothing that authenticates anything.

import type { Principal } from 'portta-auth-core'

export interface PanelPrincipal {
  kind: 'local' | 'user' | 'token'
  name: string
  email: string | null
  role: 'owner' | 'admin' | 'developer' | 'viewer'
  actor: string
  actorKind: 'human' | 'agent'
  permissions: string[]
  scope: 'all' | number[]
}

export function panelPrincipal(principal: Principal): PanelPrincipal {
  return {
    kind: principal.kind,
    name: principal.name,
    email: principal.email,
    role: principal.role,
    actor: principal.actor,
    actorKind: principal.actorKind,
    permissions: [...principal.permissions].sort(),
    scope: principal.scope === 'all' ? 'all' : [...principal.scope].sort((a, b) => a - b),
  }
}
