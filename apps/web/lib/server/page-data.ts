import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { readActivity, readProject, readRepository, readSessions } from 'portta-server'
import { cache } from 'react'
import { serverDeps } from './deps.ts'
import { requirePrincipal } from './principal.ts'

// What a page reads, deduplicated within one render.
//
// A layout and the page inside it both want the Project: the layout for the
// header and the tabs, the page for its body. `cache()` makes that one read
// rather than two, without either of them knowing about the other.
//
// Each of these resolves the principal itself, so a page cannot forget to — and
// so a page never has to thread it through. The layout above has already
// redirected anybody without one.

/**
 * The principal, or a redirect.
 *
 * The layout above redirects too, and gets there first in the normal case. This
 * is the one that matters when Next renders a layout and its page in parallel:
 * without it the page throws a real error into the log a moment before the
 * layout's redirect lands, and that error is the one somebody would go looking
 * at.
 */
async function context() {
  const principal = await requirePrincipal()
  if (!principal) redirect('/sign-in')
  return { deps: serverDeps(), principal }
}

export const projectPage = cache(async (slug: string) => {
  const { deps, principal } = await context()
  return readProject(deps, principal, slug)
})

export const repositoryPage = cache(async (id: string) => {
  const { deps, principal } = await context()
  return readRepository(deps, principal, id)
})

export const activityPage = cache(async (query: { projectId?: string; issueRef?: string; limit?: number } = {}) => {
  const { deps, principal } = await context()
  return readActivity(deps, principal, query)
})

export const sessionsPage = cache(async (query: { projectId?: string; issueRef?: string; limit?: number } = {}) => {
  const { deps, principal } = await context()
  return readSessions(deps, principal, { status: ['active'], ...query })
})

/** Read-only mode is a property of the panel, and every page asks it. */
export function panelIsReadOnly(): boolean {
  return serverDeps().config.readOnly
}

/**
 * Whether this panel has accounts at all.
 *
 * In `open` mode there is nobody to be: no users, no tokens, no second factor
 * and nothing to audit. Settings shows those sections only when they mean
 * something, because an empty Users page says the feature is broken rather
 * than absent.
 */
export function panelSignsPeopleIn(): boolean {
  return serverDeps().security.mode === 'protected'
}

/**
 * A page only somebody with this permission has.
 *
 * `notFound()` rather than a refusal: a page a role never has is not part of
 * that person's panel, and the navigation does not offer it either. A 403 page
 * would be a door with a sign on it.
 */
export async function pageNeeds(permission: string): Promise<void> {
  const { principal } = await context()
  if (!principal.permissions.has(permission as never)) notFound()
}

/** The principal a page renders for, as the browser may see it. */
export async function pagePrincipal() {
  const { principal } = await context()
  return principal
}
