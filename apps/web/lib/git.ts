// What a Git snapshot says, decided once.

import type { GitInfo, ProjectGit, RepositoryGit } from 'portta-contracts'

export type GitState = 'clean' | 'dirty' | 'detached' | 'not-collected' | 'stale'

/** Everything the working tree holds that HEAD does not. */
export function changedCount(git: Pick<GitInfo, 'staged' | 'unstaged' | 'untracked' | 'unmerged'>): number {
  return git.staged + git.unstaged + git.untracked + git.unmerged
}

/**
 * Stale wins over everything: a snapshot too old to trust must not be called
 * clean. Detached wins over dirty, because the branch question comes first.
 */
export function gitState(git: GitInfo | null | undefined, stale = false): GitState {
  if (!git) return 'not-collected'
  if (stale) return 'stale'
  if (git.detached) return 'detached'
  return changedCount(git) > 0 ? 'dirty' : 'clean'
}

/**
 * A repository scan, in the shape the status line reads. The two differ only
 * in how they are keyed (a repository by its scan key, an environment by its
 * Compose project); everything the line shows is the same.
 */
export function projectGitOf(git: RepositoryGit): ProjectGit {
  return {
    project: git.name ?? git.key,
    collected: git.collected,
    collectedAt: git.collectedAt,
    ageSeconds: git.ageSeconds,
    stale: git.stale,
    staleAfterSeconds: git.staleAfterSeconds,
    workingDir: git.path,
    git: git.git,
    remote: git.remote,
    links: git.links,
    forge: git.forge,
    reason: git.reason,
    refreshCommand: git.refreshCommand,
  }
}
