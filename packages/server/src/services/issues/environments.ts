// Which issue each running environment is being worked on, and why.
//
// This is the one thing about work that stays Portta's own. GitHub does not
// know an environment exists, Linear does not either, and "what is this stack
// running for" is a question only Portta can answer — so the link is stored
// here, with an issue ref on the other end (ADR 0050).
//
// Stored links win outright. What is left is inferred, in this order: the
// environment's own `portta.issue` label, then its branch, then its namespace.
// The order is the order of deliberateness — a label is something somebody
// wrote, a namespace is something a tool generated — and first match wins.
//
// A label carries a whole ref because an environment is not inside a Project
// and has nothing to resolve a bare number against. A branch and a namespace
// carry only a number, so they are read relative to the Project's own
// repository, and produce nothing when the Project has none.

import {
  githubIssueRef,
  ISSUE_LABEL,
  issueNumberFromBranch,
  issueNumberFromNamespace,
  issueRefFromLabel,
  parseIssueRef,
} from 'portta-core'
import type { PanelConfig } from '../../config.ts'
import type { Database } from '../../db/index.ts'
import { readProjectGit } from '../git.ts'
import type { Snapshot } from '../inventory.ts'

export type IssueLinkSource = 'manual' | 'label' | 'branch' | 'namespace'

export interface ResolvedIssueLink {
  issueRef: string
  source: IssueLinkSource
  reason: string
  branch: string | null
}

const REASON: Record<IssueLinkSource, (facts: { branch: string | null; name: string }) => string> = {
  manual: () => 'linked by hand',
  label: () => `this environment declares ${ISSUE_LABEL}`,
  branch: (facts) => `this environment is on branch ${facts.branch}`,
  namespace: (facts) => `this environment is namespaced ${facts.name}`,
}

export interface StoredIssueLink {
  composeProject: string
  issueRef: string
  source: IssueLinkSource
  branch: string | null
}

export interface ResolveInput {
  snapshot: Snapshot
  stored: readonly StoredIssueLink[]
  branches: ReadonlyMap<string, string | null>
  /**
   * `owner/repo` for the Project that adopted each environment, when it has
   * one. A bare number in a branch means nothing without it, so an environment
   * whose Project has no GitHub repository is simply not inferred from a
   * branch — a wrong link is worse than no link.
   */
  githubSlugs: ReadonlyMap<string, string | null>
}

export function resolveIssueLinks(input: ResolveInput): Map<string, ResolvedIssueLink> {
  const resolved = new Map<string, ResolvedIssueLink>()
  const storedByProject = new Map(input.stored.map((row) => [row.composeProject, row]))

  for (const environment of input.snapshot.environments) {
    const stored = storedByProject.get(environment.name)
    if (stored && parseIssueRef(stored.issueRef)) {
      resolved.set(environment.name, {
        issueRef: stored.issueRef,
        source: stored.source,
        reason: REASON[stored.source]({ branch: stored.branch, name: environment.name }),
        branch: stored.branch,
      })
      continue
    }

    const branch = input.branches.get(environment.name) ?? null
    const labels = environment.services[0]?.labels ?? {}

    const fromLabel = issueRefFromLabel(labels)
    if (fromLabel) {
      resolved.set(environment.name, {
        issueRef: fromLabel,
        source: 'label',
        reason: REASON.label({ branch, name: environment.name }),
        branch,
      })
      continue
    }

    const slug = input.githubSlugs.get(environment.name) ?? null
    if (!slug) continue

    const fromBranch = issueNumberFromBranch(branch)
    if (fromBranch) {
      resolved.set(environment.name, {
        issueRef: githubIssueRef(slug, fromBranch),
        source: 'branch',
        reason: REASON.branch({ branch, name: environment.name }),
        branch,
      })
      continue
    }

    const fromNamespace = issueNumberFromNamespace(environment.namespace) ?? issueNumberFromNamespace(environment.name)
    if (fromNamespace) {
      resolved.set(environment.name, {
        issueRef: githubIssueRef(slug, fromNamespace),
        source: 'namespace',
        reason: REASON.namespace({ branch, name: environment.name }),
        branch,
      })
    }
  }
  return resolved
}

/** Branches the host scan collected, one read per environment. */
export function branchesOf(config: PanelConfig, snapshot: Snapshot): Map<string, string | null> {
  return new Map(
    snapshot.environments.map((environment) => [
      environment.name,
      readProjectGit(config, environment.name).git?.branch ?? null,
    ]),
  )
}

/** Everything `resolveIssueLinks` needs, read once per request. */
export async function loadIssueLinks(
  config: PanelConfig,
  db: Database,
  snapshot: Snapshot,
  githubSlugs: ReadonlyMap<string, string | null>,
): Promise<Map<string, ResolvedIssueLink>> {
  return resolveIssueLinks({
    snapshot,
    stored: await db.environments.listIssueLinks(),
    branches: branchesOf(config, snapshot),
    githubSlugs,
  })
}

export function panelUrlFor(project: string): string {
  return `#/environments/${encodeURIComponent(project)}`
}
