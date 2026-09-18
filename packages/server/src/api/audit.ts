// Writing an audit line from a route.
//
// The services write these (ADR 0013), and where a Portta service owns the
// write that is exactly what happens (`services/users.ts`). The operational
// endpoints are different: starting an environment, removing a container and
// opening a bridge are Docker calls with no database in them, and this
// codebase already records their *activity* from the route for that reason.
// The audit line goes where the activity line goes, so the two cannot drift.

import type { Context } from 'hono'
import { principalOf } from 'portta-auth-core/hono'
import type { AppDeps } from '../deps.ts'
import { type AuditInput, audit } from '../services/audit.ts'

export function record(deps: AppDeps, c: Context, entry: AuditInput): Promise<void> {
  return audit(deps.db.handle, principalOf(c), entry)
}
