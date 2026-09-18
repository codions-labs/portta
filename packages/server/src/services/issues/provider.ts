// Which provider a Project's work lives in, and what to address it by.
//
// This is the whole of scope 5's "a project declares one provider". There is no
// registry, no plugin and no factory: two providers, one function that answers
// which, and a coordinate that is a repository slug for GitHub and a team key
// for Linear. Anything more would be a framework for a set of size two.
//
// The default is derived rather than stored. A Project whose repository has a
// GitHub remote is a GitHub project without anybody configuring it, which is
// what "GitHub Issues é o padrão quando o projeto está vinculado ao GitHub"
// means in practice. `projects.task_provider` exists only to override that.

import { parseRemote, type TaskProvider } from 'portta-core'

export interface ProjectRepositoryFacts {
  remoteUrl: string | null
  position: number
}

export interface ProjectWorkFacts {
  slug: string
  /** `projects.task_provider`: null means "not chosen", never "local". */
  taskProvider: TaskProvider | null
  /** The Project's repositories, in the order the panel shows them. */
  repositories: readonly ProjectRepositoryFacts[]
  /** `PORTTA_LINEAR_TEAM` scoped to this Project, when the operator set one. */
  linearTeam: string | null
}

export type WorkCoordinate = { provider: 'github'; repo: string } | { provider: 'linear'; team: string }

export class NoProvider extends Error {
  readonly hint: string

  constructor(message: string, hint: string) {
    super(message)
    this.name = 'NoProvider'
    this.hint = hint
  }
}

/** The first repository with a GitHub remote, in the Project's own order. */
export function githubSlugFor(project: ProjectWorkFacts): string | null {
  for (const repository of [...project.repositories].sort((a, b) => a.position - b.position)) {
    const remote = repository.remoteUrl ? parseRemote(repository.remoteUrl) : null
    if (remote?.kind === 'github' && remote.slug.includes('/')) return remote.slug
  }
  return null
}

export function providerFor(project: ProjectWorkFacts): TaskProvider | null {
  if (project.taskProvider) return project.taskProvider
  return githubSlugFor(project) ? 'github' : null
}

/**
 * Where this Project's issues actually are, or why the question has no answer.
 *
 * Refusing with a reason rather than returning null: every caller would
 * otherwise invent its own message for "this project has no issues", and the
 * three reasons are genuinely different things for an operator to fix.
 */
export function coordinateFor(project: ProjectWorkFacts): WorkCoordinate {
  const provider = providerFor(project)
  if (!provider) {
    throw new NoProvider(
      `${project.slug} is not linked to anywhere its work lives`,
      'add a repository with a GitHub remote, or choose Linear in the project settings',
    )
  }
  if (provider === 'linear') {
    if (!project.linearTeam) {
      throw new NoProvider(
        `${project.slug} uses Linear but names no team`,
        'set the Linear team in the project settings',
      )
    }
    return { provider: 'linear', team: project.linearTeam.toUpperCase() }
  }
  const repo = githubSlugFor(project)
  if (!repo) {
    throw new NoProvider(
      `${project.slug} uses GitHub Issues but none of its repositories has a GitHub remote`,
      'add the repository, or set its remote with git remote add origin',
    )
  }
  return { provider: 'github', repo }
}
