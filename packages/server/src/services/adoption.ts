// Which Project a running environment belongs to, and why.
//
// Three sources with a stated precedence, each a pure function over data the
// panel already has. The reason is recorded so the UI can say *"adopted because
// it carries portta.project: meu-produto"* rather than presenting a
// mapping with no explanation — which is also how the label and the database
// stop disagreeing: they are one list with a provenance.

import type { Environment } from 'portta-contracts'

export type AdoptionSource = 'manual' | 'label' | 'path'

export interface ProjectCoordinates {
  id: string
  slug: string
  /** Absolute host path of this Project's directory under Projects Home, when it has one. */
  path?: string | null
}

export interface Adoption {
  projectId: string
  source: AdoptionSource
}

function under(path: string, root: string): boolean {
  return root !== '' && (path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`))
}

/**
 * Resolves one environment.
 *
 * Manual always wins, because the user said so. A `portta.project` label
 * matching a slug is honoured next, because the project declared it (ADR 0001).
 * A working directory under exactly one Project's directory is last: a
 * directory two Projects claim adopts nothing, because an automatic adoption
 * that is wrong is worse than none.
 */
export function resolveAdoption(
  environment: Pick<Environment, 'name' | 'group'> & { workingDir?: string | null },
  projects: ProjectCoordinates[],
  manual: Map<string, string>,
): Adoption | null {
  const manualId = manual.get(environment.name)
  if (manualId !== undefined) return { projectId: manualId, source: 'manual' }

  if (environment.group) {
    const declared = projects.find((candidate) => candidate.slug === environment.group)
    if (declared) return { projectId: declared.id, source: 'label' }
  }

  const workingDir = environment.workingDir ?? null
  if (workingDir) {
    const owners = projects.filter((candidate) => candidate.path && under(workingDir, candidate.path))
    // The deepest directory wins over a parent Project that merely contains it.
    const deepest = Math.max(0, ...owners.map((candidate) => candidate.path?.length ?? 0))
    const closest = owners.filter((candidate) => (candidate.path?.length ?? 0) === deepest)
    if (closest.length === 1) return { projectId: closest[0]!.id, source: 'path' }
  }
  return null
}

export function resolveAdoptions(
  environments: ReadonlyArray<Pick<Environment, 'name' | 'group'> & { workingDir?: string | null }>,
  projects: ProjectCoordinates[],
  manual: Map<string, string>,
): Map<string, Adoption> {
  const resolved = new Map<string, Adoption>()
  for (const environment of environments) {
    const adoption = resolveAdoption(environment, projects, manual)
    if (adoption) resolved.set(environment.name, adoption)
  }
  return resolved
}
