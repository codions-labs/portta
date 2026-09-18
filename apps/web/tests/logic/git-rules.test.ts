import { describe, expect, it } from 'vitest'
import { changedCount, gitState } from '@/lib/git'

const git = (over: Partial<Parameters<typeof gitState>[0] & object> = {}) => ({
  branch: 'main',
  detached: false,
  head: { sha: 'abc', shortSha: 'abc', subject: '', author: '', date: 0 },
  staged: 0,
  unstaged: 0,
  untracked: 0,
  unmerged: 0,
  dirty: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  remote: null,
  ...over,
})

describe('git rules', () => {
  it('counts everything HEAD does not hold', () => {
    expect(changedCount(git({ staged: 2, unstaged: 5, untracked: 1, unmerged: 1 }))).toBe(9)
  })
  it('names the state, stale first', () => {
    expect(gitState(null)).toBe('not-collected')
    expect(gitState(git())).toBe('clean')
    expect(gitState(git({ untracked: 1 }))).toBe('dirty')
    expect(gitState(git({ detached: true, untracked: 1 }))).toBe('detached')
    expect(gitState(git({ untracked: 1 }), true)).toBe('stale')
  })
})
