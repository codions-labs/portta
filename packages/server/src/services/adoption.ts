// Which Project a running environment belongs to, and why.
//
// Three sources with a stated precedence, each a pure function over data the
// panel already has. The reason is recorded so the UI can say *"adopted because
// it carries portta.project: meu-produto"* rather than presenting a
// mapping with no explanation — which is also how the label and the database
// stop disagreeing: they are one list with a provenance.

import type { Environment } from 'portta-contracts'

export type AdoptionSource = 'manual' | 'label' | 'repo-match' | 'path'

export interface ProjectCoordinates {
  id: string
  slug: string
  /** Repository coordinates (`owner/name`, lowercased) this Project owns: GitHub names and remote URLs alike. */
  repositories: string[]
  /** Absolute host paths this Project owns: its resolved Projects Home directory and its repositories' paths. */
  paths?: string[]
  /** Host scan keys of this Project's repositories. */
  scanKeys?: string[]
}

export interface Adoption {
  projectId: string
  source: AdoptionSource
}

/** `git@github.com:acme/alpha.git` and `https://github.com/acme/alpha` both → `acme/alpha`. */
export function repositoryCoordinate(repoUrl: string | null): string | null {
  if (!repoUrl) return null
  const cleaned = repoUrl.trim().replace(/\.git$/, '')
  const ssh = /^[^@]+@[^:]+:(.+)$/.exec(cleaned)
  if (ssh?.[1]) return ssh[1].toLowerCase()
  try {
    const parsed = new URL(cleaned)
    return parsed.pathname.replace(/^\//, '').toLowerCase() || null
  } catch {
    return cleaned.includes('/') ? cleaned.toLowerCase() : null
  }
}

/**
 * Resolves one environment.
 *
 * Manual always wins, because the user said so. A `portta.project` label
 * matching a slug is honoured next, because the project declared it (ADR 0001).
 * A repository match is a suggestion, and is applied **only when exactly one
 * Project owns that coordinate** — an automatic adoption that is wrong is
 * worse than none, so an ambiguous match adopts nothing and lets the user say.
 */
export interface AdoptionFacts {
  /** COMPOSE_PROJECT_NAME → repository scan key, from the host scan index. */
  environmentKeys?: Record<string, string>
}

function underOneOf(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => root !== '' && (path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`)))
}

export function resolveAdoption(
  project: Pick<Environment, 'name' | 'group' | 'repo' | 'repoUrl'> & { workingDir?: string | null },
  projects: ProjectCoordinates[],
  manual: Map<string, string>,
  facts: AdoptionFacts = {},
): Adoption | null {
  const manualId = manual.get(project.name)
  if (manualId !== undefined) return { projectId: manualId, source: 'manual' }

  if (project.group) {
    const declared = projects.find((candidate) => candidate.slug === project.group)
    if (declared) return { projectId: declared.id, source: 'label' }
  }

  const coordinate = repositoryCoordinate(project.repoUrl) ?? project.repo?.toLowerCase() ?? null
  if (coordinate !== null) {
    const owners = projects.filter((candidate) => candidate.repositories.includes(coordinate))
    if (owners.length === 1) return { projectId: owners[0]!.id, source: 'repo-match' }
    if (owners.length > 1) return null
  }

  // Path: the environment runs from a repository the host scan attributed to
  // exactly one Project, or its working directory sits under one Project's
  // directory. A directory two Projects claim adopts nothing.
  const key = facts.environmentKeys?.[project.name]
  const byKey = key ? projects.filter((candidate) => candidate.scanKeys?.includes(key)) : []
  if (byKey.length === 1) return { projectId: byKey[0]!.id, source: 'path' }
  if (byKey.length > 1) return null

  const workingDir = project.workingDir ?? null
  if (workingDir) {
    const byPath = projects.filter((candidate) => underOneOf(workingDir, candidate.paths ?? []))
    if (byPath.length === 1) return { projectId: byPath[0]!.id, source: 'path' }
  }
  return null
}

export function resolveAdoptions(
  environments: ReadonlyArray<
    Pick<Environment, 'name' | 'group' | 'repo' | 'repoUrl'> & { workingDir?: string | null }
  >,
  projects: ProjectCoordinates[],
  manual: Map<string, string>,
  facts: AdoptionFacts = {},
): Map<string, Adoption> {
  const resolved = new Map<string, Adoption>()
  for (const environment of environments) {
    const adoption = resolveAdoption(environment, projects, manual, facts)
    if (adoption) resolved.set(environment.name, adoption)
  }
  return resolved
}
