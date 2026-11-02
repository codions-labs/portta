import { describe, expect, it } from 'vitest'
import { parseGitHead, parseGitStatus } from './git.ts'

const STATUS = [
  '# branch.oid a41f2c9d0c1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
  '# branch.head develop',
  '# branch.upstream origin/develop',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaaa bbbb src/cart/validate.ts',
  '1 A. N... 000000 100644 100644 0000 cccc new file.md',
  '1 .D N... 100644 100644 000000 dddd eeee old.txt',
  '? notes.md',
].join('\n')

describe('parseGitStatus', () => {
  it('reads the branch, where it stands against its upstream, and what is not committed', () => {
    expect(parseGitStatus(STATUS)).toEqual({
      branch: 'develop',
      detached: false,
      upstream: 'origin/develop',
      ahead: 2,
      behind: 1,
      oid: 'a41f2c9d0c1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
      changed: 3,
      untracked: 1,
      files: [
        { path: 'src/cart/validate.ts', status: 'M' },
        { path: 'new file.md', status: 'A' },
        { path: 'old.txt', status: 'D' },
        { path: 'notes.md', status: 'U' },
      ],
    })
  })

  it('has no ahead or behind without an upstream, and no branch when detached', () => {
    const parsed = parseGitStatus('# branch.oid abc\n# branch.head (detached)\n')
    expect(parsed).toMatchObject({ branch: null, detached: true, upstream: null, ahead: null, behind: null })
  })

  it('knows a repository with no commit yet', () => {
    expect(parseGitStatus('# branch.oid (initial)\n# branch.head main\n')).toMatchObject({ oid: null, branch: 'main' })
  })

  it('counts everything but lists only the first of it', () => {
    const many = Array.from({ length: 30 }, (_, index) => `? file-${index}`).join('\n')
    const parsed = parseGitStatus(many)
    expect(parsed.untracked).toBe(30)
    expect(parsed.files).toHaveLength(20)
  })

  it('is clean when there is nothing to say', () => {
    expect(parseGitStatus('# branch.oid abc\n# branch.head main\n')).toMatchObject({
      changed: 0,
      untracked: 0,
      files: [],
    })
  })
})

describe('parseGitHead', () => {
  it('reads the last commit', () => {
    expect(parseGitHead('a41f2c9\u001ffix(cart): valida o SKU\u001fAda Lovelace\u001f1793600000\n')).toEqual({
      sha: 'a41f2c9',
      subject: 'fix(cart): valida o SKU',
      author: 'Ada Lovelace',
      at: 1793600000,
    })
  })

  it('says nothing for what is not a commit', () => {
    expect(parseGitHead('')).toBeNull()
    expect(parseGitHead('a\u001fb\u001fc\u001fnot-a-time')).toBeNull()
  })
})
