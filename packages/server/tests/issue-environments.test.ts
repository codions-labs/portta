// Which issue an environment is being worked on, and how Portta decided.
//
// This is the one thing about work that stays Portta's own, and it is a pure
// function: a stored row, a label, a branch, a namespace. The order is the
// order of deliberateness, and the negatives matter as much as the positives —
// a wrong link points a person at somebody else's issue.

import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../src/services/inventory.ts'
import { resolveIssueLinks, type StoredIssueLink } from '../src/services/issues/environments.ts'

interface Fixture {
  name: string
  namespace?: string | null
  labels?: Record<string, string>
}

function snapshotOf(environments: Fixture[]): Snapshot {
  return {
    environments: environments.map((environment) => ({
      name: environment.name,
      namespace: environment.namespace ?? null,
      services: [{ labels: environment.labels ?? {} }],
    })),
  } as unknown as Snapshot
}

const SLUG = 'acme/api'

function resolve(
  environments: Fixture[],
  options: { stored?: StoredIssueLink[]; branches?: Record<string, string | null>; slug?: string | null } = {},
) {
  const slug = options.slug === undefined ? SLUG : options.slug
  return resolveIssueLinks({
    snapshot: snapshotOf(environments),
    stored: options.stored ?? [],
    branches: new Map(
      environments.map((environment) => [environment.name, options.branches?.[environment.name] ?? null]),
    ),
    githubSlugs: new Map(environments.map((environment) => [environment.name, slug])),
  })
}

describe('resolving the issue an environment is running for', () => {
  it('prefers a stored link over everything the environment itself says', () => {
    const resolved = resolve(
      [{ name: 'alpha-issue9', namespace: 'alpha-issue9', labels: { 'portta.issue': 'github:acme/api#7' } }],
      {
        stored: [{ composeProject: 'alpha-issue9', issueRef: 'linear:ENG-42', source: 'manual', branch: null }],
        branches: { 'alpha-issue9': 'issue-8' },
      },
    )
    expect(resolved.get('alpha-issue9')).toMatchObject({ issueRef: 'linear:ENG-42', source: 'manual' })
  })

  // A ref that cannot be parsed addresses nothing, so the row is worth less
  // than what the environment declares about itself.
  it('ignores a stored row whose ref is not a ref', () => {
    const resolved = resolve([{ name: 'alpha', labels: { 'portta.issue': 'github:acme/api#7' } }], {
      stored: [{ composeProject: 'alpha', issueRef: 'nonsense', source: 'manual', branch: null }],
    })
    expect(resolved.get('alpha')).toMatchObject({ issueRef: 'github:acme/api#7', source: 'label' })
  })

  it('prefers a label somebody wrote over a branch, and a branch over a namespace', () => {
    const byLabel = resolve(
      [{ name: 'alpha-issue9', namespace: 'alpha-issue9', labels: { 'portta.issue': 'github:acme/api#7' } }],
      { branches: { 'alpha-issue9': 'feature/issue-8' } },
    )
    expect(byLabel.get('alpha-issue9')).toMatchObject({ issueRef: 'github:acme/api#7', source: 'label' })

    const byBranch = resolve([{ name: 'alpha-issue9', namespace: 'alpha-issue9' }], {
      branches: { 'alpha-issue9': 'feature/issue-8' },
    })
    expect(byBranch.get('alpha-issue9')).toMatchObject({ issueRef: 'github:acme/api#8', source: 'branch' })

    const byNamespace = resolve([{ name: 'alpha-issue9', namespace: 'alpha-issue9' }])
    expect(byNamespace.get('alpha-issue9')).toMatchObject({ issueRef: 'github:acme/api#9', source: 'namespace' })
  })

  // A branch and a namespace carry a bare number. With no repository to read it
  // against, that number addresses nothing, and a wrong link is worse than none.
  it('infers nothing from a branch or a namespace when the Project has no GitHub repository', () => {
    const resolved = resolve([{ name: 'alpha-issue9', namespace: 'alpha-issue9' }, { name: 'beta' }], {
      branches: { 'alpha-issue9': 'feature/issue-8', beta: 'issue-8' },
      slug: null,
    })
    expect(resolved.size).toBe(0)
  })

  // The label carries a whole ref, so it still works: an environment is not
  // inside a Project and the label is the only source that says which provider.
  it('still reads a label when the Project has no GitHub repository', () => {
    const resolved = resolve([{ name: 'alpha', labels: { 'portta.issue': 'linear:ENG-42' } }], { slug: null })
    expect(resolved.get('alpha')).toMatchObject({ issueRef: 'linear:ENG-42', source: 'label' })
  })

  it('says why, in terms of what it looked at', () => {
    const resolved = resolve([{ name: 'alpha' }], { branches: { alpha: 'issue-8' } })
    expect(resolved.get('alpha')).toMatchObject({ reason: 'this environment is on branch issue-8', branch: 'issue-8' })
  })

  it('links nothing when the environment says nothing', () => {
    expect(resolve([{ name: 'alpha' }]).size).toBe(0)
  })
})
