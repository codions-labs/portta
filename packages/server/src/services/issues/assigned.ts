// What is assigned to whoever runs this host, across every provider.
//
// One call for the whole dashboard. `gh search issues --assignee @me` answers
// across repositories, so the panel never asks per Project — that would be one
// `gh` process per Project on every dashboard load, and a dashboard that got
// slower as somebody added Projects.
//
// Assignment is the provider's, not Portta's. A Portta user and a GitHub login
// are different identities and Portta does not map them
// (docs/development/adr/0018-github-issues-through-the-gh-cli.md): "@me" is
// whoever the host is signed in as. On a single-operator installation, which is
// what Portta is for, that is the same person; on a shared one the dashboard
// shows the host's work, and the Project pages remain the per-repository view.

import type { ForgeStatus, IssueSummary } from 'portta-contracts'
import type { AppDeps } from '../../deps.ts'
import { forgeStatus } from './host-client.ts'
import { issuePanelUrl } from './read.ts'
import { type GhIssue, githubSummary } from './view.ts'

export interface AssignedWork {
  work: { available: boolean; assigned: IssueSummary[]; unavailableReason: string | null }
  status: ForgeStatus
}

/** How many issues the dashboard shows before it stops being a dashboard. */
const LIMIT = 25

export async function assignedWork(deps: AppDeps): Promise<AssignedWork> {
  const status = await forgeStatus(deps.forge)

  if (!status.github.authenticated) {
    return {
      status,
      work: {
        available: false,
        assigned: [],
        unavailableReason: status.github.reason ?? 'no provider on this host is signed in',
      },
    }
  }

  try {
    const rows = await deps.forge.call<GhIssue[]>({ path: '/assigned', query: { limit: LIMIT } })
    // Which Project a searched issue belongs to is not known here — the search
    // crosses repositories Portta may not have registered — so the panel link
    // is built against the Project whose repository matches, and the provider's
    // own URL is always there as the fallback the row actually renders.
    const slugs = deps.db.status().available
      ? new Map(
          (await deps.db.repositories.list()).flatMap((row) =>
            row.github ? [[row.github.slug.toLowerCase(), row.projectId] as const] : [],
          ),
        )
      : new Map<string, string>()
    const projectSlug = deps.db.status().available
      ? new Map((await deps.db.projects.list()).map((project) => [project.id, project.slug]))
      : new Map<string, string>()

    const assigned = rows.map((row) => {
      const repo = row.repository?.nameWithOwner ?? ''
      const projectId = slugs.get(repo.toLowerCase())
      const slug = projectId ? projectSlug.get(projectId) : undefined
      return githubSummary(row, repo, (ref) => (slug ? issuePanelUrl(slug, ref) : row.url))
    })
    return { status, work: { available: true, assigned, unavailableReason: null } }
  } catch (error) {
    return {
      status,
      work: {
        available: false,
        assigned: [],
        unavailableReason: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
