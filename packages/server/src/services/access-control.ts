// Which Project a thing belongs to.
//
// `authorize(principal, permission, { projectId })` answers whether somebody
// may reach a resource. Answering it needs the projectId, and only the services
// know where that comes from: an adoption row for an environment, the target
// environment for a bridge. This file is that lookup, in one place, so a route
// never guesses.
//
// The scope rules themselves are in ADR 0038 and are enforced by `authorize`.
// Nothing here decides anything; it only says what the resource is part of.

import { type Principal, sees } from 'portta-auth-core'
import type { Database } from '../db/index.ts'

/**
 * A project id as the scope check needs it.
 *
 * The API layer carries ids as strings — they are `bigint` identities, and the
 * contract says string so a caller never has to think about precision. A
 * membership set holds numbers. This is the one conversion, and it refuses
 * anything that is not an id rather than producing a `NaN` that quietly
 * matches nothing.
 */
export function projectScope(id: string | number | null | undefined): number | null {
  if (id === null || id === undefined) return null
  const numeric = typeof id === 'number' ? id : Number(id)
  if (!Number.isSafeInteger(numeric)) throw new Error(`not a project id: ${String(id)}`)
  return numeric
}

/**
 * Which Project adopted each environment, by Compose name.
 *
 * Through the repository rather than a query of its own, because the adoption
 * rows are small, every caller needs several of them at once, and a panel whose
 * database is unreachable should answer "nothing is adopted" rather than fail:
 * an environment with no Project is visible to `scope: 'all'` alone, which is
 * the closed direction to fail in.
 */
export async function adoptions(db: Database): Promise<Map<string, number>> {
  try {
    const rows = await db.projects.listEnvironments()
    return new Map(rows.map((row) => [row.composeProject, projectScope(row.projectId)!]))
  } catch {
    // A database that cannot be read knows of no adoption, which makes every
    // environment unclaimed and therefore visible to `scope: 'all'` alone. That
    // is the closed direction, and it keeps the Docker-backed pages answering
    // while the database is down rather than turning a degraded panel into a 500.
    return new Map()
  }
}

/**
 * The Project that adopted one environment, by its Compose name.
 *
 * `null` means nothing adopted it: a stack running on the host that no Project
 * claims. There is no membership to check for those, so they are visible only
 * to somebody who sees everything (ADR 0038).
 */
export async function projectOfEnvironment(db: Database, name: string): Promise<number | null> {
  return (await adoptions(db)).get(name) ?? null
}

/**
 * Filter, rather than refuse.
 *
 * A listing is not a request for a named resource: a developer asking for the
 * Projects wants theirs, not a 403 about somebody else's. `authorize` is for
 * reaching one by name.
 */
export function visible<T>(principal: Principal, rows: readonly T[], projectIdOf: (row: T) => number | null): T[] {
  if (principal.scope === 'all') return [...rows]
  return rows.filter((row) => {
    const projectId = projectIdOf(row)
    return projectId !== null && sees(principal, projectId)
  })
}

/**
 * What a live event is about, and whether this principal may see it.
 *
 * `LiveEvent.project` is a name, and the two kinds of publisher put two kinds
 * of name in it: a Project slug for the work events, a Compose project for the
 * environment ones. Both are resolved, because guessing which one a given event
 * carries would be a rule that breaks the first time somebody adds a publisher.
 *
 * An event with no name is about the host — a setting, the gateway, the
 * integration — and belongs to whoever sees everything.
 *
 * The maps go stale on a stream that stays open for hours, so they are rebuilt
 * on a short interval rather than captured once. Failing to rebuild them leaves
 * the previous answer, which is the closed direction for a principal whose
 * membership was just removed only until the next refresh.
 */
export interface EventVisibility {
  allows(event: { project: string | null }): boolean
  refresh(): Promise<void>
}

export function eventVisibility(db: Database, principal: Principal, ttlMs = 5_000): EventVisibility {
  let bySlug = new Map<string, number>()
  let byEnvironment = new Map<string, number>()
  let at = 0

  return {
    async refresh() {
      if (principal.scope === 'all') return
      if (Date.now() - at < ttlMs) return
      at = Date.now()
      byEnvironment = await adoptions(db)
      try {
        const rows = await db.projects.list()
        bySlug = new Map(rows.map((row) => [row.slug, projectScope(row.id)!]))
      } catch {
        bySlug = new Map()
      }
    },
    allows(event) {
      if (principal.scope === 'all') return true
      if (event.project === null) return false
      const projectId = bySlug.get(event.project) ?? byEnvironment.get(event.project) ?? null
      return projectId !== null && sees(principal, projectId)
    },
  }
}
