import { describe, expect, it } from 'vitest'
import { branchUrl, commitUrl, parseRemote } from './forge.ts'

describe('parseRemote', () => {
  it('reads the shapes people actually have in origin', () => {
    const cases: [string, string, string][] = [
      ['git@github.com:owner/repo.git', 'github.com', 'owner/repo'],
      ['https://github.com/owner/repo.git', 'github.com', 'owner/repo'],
    ]
    for (const [url, host, slug] of cases) {
      expect(parseRemote(url)).toMatchObject({ host, slug })
    }
  })
})

describe('derived links', () => {
  const github = parseRemote('git@github.com:owner/repo.git')!
  const gitlab = parseRemote('https://gitlab.com/group/repo.git')!
  const bitbucket = parseRemote('git@bitbucket.org:owner/repo.git')!

  it("follows each forge's own shape", () => {
    expect(commitUrl(github, '9f2c1ab')).toBe('https://github.com/owner/repo/commit/9f2c1ab')
    expect(commitUrl(gitlab, '9f2c1ab')).toBe('https://gitlab.com/group/repo/commit/9f2c1ab')
    expect(commitUrl(bitbucket, '9f2c1ab')).toBe('https://bitbucket.org/owner/repo/commits/9f2c1ab')
    expect(branchUrl(github, 'feature/59')).toBe('https://github.com/owner/repo/tree/feature/59')
    expect(branchUrl(gitlab, 'feature/59')).toBe('https://gitlab.com/group/repo/-/tree/feature/59')
  })

  it('escapes a branch name without mangling its slashes', () => {
    expect(branchUrl(github, 'feature/a b')).toBe('https://github.com/owner/repo/tree/feature/a%20b')
  })
})
