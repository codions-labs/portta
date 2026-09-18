// The reads the issue routes share: what a Project knows about its own work,
// and what Portta knows about an issue that the provider does not.

import type { Issue, IssueEnvironmentLink } from 'portta-contracts'
import { formatIssueRef, githubIssueRef, parseGitHubIssueRef, parseIssueRef } from 'portta-core'
import type { Database, ProjectRecord } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import type { Snapshot } from '../inventory.ts'
import { loadIssueLinks, panelUrlFor, type ResolvedIssueLink } from './environments.ts'
import { githubSlugFor, type ProjectWorkFacts, type WorkCoordinate } from './provider.ts'
import { worktreesForIssue } from './taskflow-work.ts'
import { type GhComment, type GhIssue, githubIssue, type LinearIssue, linearIssue } from './view.ts'

/** Where a Project's issues are, from its own rows. */
export async function workFactsFor(db: Database, project: ProjectRecord): Promise<ProjectWorkFacts> {
  const repositories = await db.repositories.list(project.id)
  return {
    slug: project.slug,
    taskProvider: project.taskProvider,
    repositories: repositories.map((row) => ({ remoteUrl: row.remoteUrl, position: row.position })),
    linearTeam: project.linearTeam,
  }
}

/**
 * The environments running for one issue.
 *
 * The link is resolved for every environment at once — a stored row, a label, a
 * branch, a namespace — and then filtered to this issue, because the resolution
 * is what decides which environment belongs to which issue and doing it per
 * issue would ask the same question once per row.
 */
export function environmentLinksFor(
  issueRef: string,
  snapshot: Snapshot,
  links: ReadonlyMap<string, ResolvedIssueLink>,
): IssueEnvironmentLink[] {
  const out: IssueEnvironmentLink[] = []
  for (const environment of snapshot.environments) {
    const link = links.get(environment.name)
    if (!link || link.issueRef !== issueRef) continue
    out.push({
      environment: environment.name,
      source: link.source,
      reason: link.reason,
      running: environment.runningCount > 0,
      serviceCount: environment.serviceCount,
      runningCount: environment.runningCount,
      unhealthyCount: environment.unhealthyCount,
      urls: environment.urls,
      branch: link.branch,
      panelUrl: panelUrlFor(environment.name),
    })
  }
  return out
}

/**
 * Where the panel shows an issue.
 *
 * The ref goes in whole and encoded, rather than being split into a repository
 * and a number: one segment means one route, and a ref that names a repository
 * the Project is no longer linked to still produces a URL that says so.
 */
export function issuePanelUrl(projectSlug: string, ref: string): string {
  return `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(ref)}`
}

/**
 * One issue, read from its provider and enriched with what Portta knows.
 *
 * Shared by the issue routes and the Development Context so the two can never
 * show a different issue for the same ref: the key is extracted from the ref
 * here, once, rather than by each caller splitting a string.
 */
export async function readIssue(
  deps: Pick<AppDeps, 'forge' | 'cache' | 'config' | 'db'>,
  db: Database,
  facts: ProjectWorkFacts,
  coordinate: WorkCoordinate,
  key: string,
): Promise<Issue> {
  const panelUrl = (ref: string) => issuePanelUrl(facts.slug, ref)
  const portta = async (ref: string): Promise<Pick<Issue, 'environments' | 'worktrees' | 'activeSessionCount'>> => {
    const snapshot = await deps.cache.get()
    const slug = githubSlugFor(facts)
    const slugs = new Map(snapshot.environments.map((environment) => [environment.name, slug]))
    const links = await loadIssueLinks(deps.config, db, snapshot, slugs)
    const sessions = await db.sessions.list({ issueRef: ref, status: ['active'], limit: 100 })
    const project = await db.projects.find(facts.slug)
    const worktrees = project ? await worktreesForIssue(deps, db, project.id, ref) : []
    return { environments: environmentLinksFor(ref, snapshot, links), worktrees, activeSessionCount: sessions.length }
  }

  if (coordinate.provider === 'linear') {
    const raw = await deps.forge.call<LinearIssue>({ path: `/linear/issues/${encodeURIComponent(key)}` })
    const ref = formatIssueRef('linear', raw.identifier)
    return linearIssue(raw, panelUrl, await portta(ref))
  }
  const raw = await deps.forge.call<GhIssue & { comments: GhComment[] }>({
    path: `/issues/${encodeURIComponent(key)}`,
    query: { repo: coordinate.repo },
  })
  const ref = githubIssueRef(coordinate.repo, raw.number)
  return githubIssue(raw, coordinate.repo, panelUrl, await portta(ref))
}

/** The provider's own key from a ref: `113` on GitHub, `ENG-42` on Linear. */
export function keyOfRef(ref: string): string | null {
  const parsed = parseIssueRef(ref)
  if (!parsed) return null
  if (parsed.provider === 'linear') return parsed.key
  const github = parseGitHubIssueRef(ref)
  return github ? String(github.number) : null
}
