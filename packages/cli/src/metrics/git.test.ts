import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGit } from './git.js'

const identity = ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.test']
const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...identity, ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  })

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'portta-git-'))
  run(root, 'init', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'one\n')
  run(root, 'add', '.')
  run(root, 'commit', '-m', 'first')
  return root
}

describe('reading a project from its folder', () => {
  it('says where the code stands, without touching it', async () => {
    const root = repository()
    writeFileSync(join(root, 'a.txt'), 'two\n')
    writeFileSync(join(root, 'new.txt'), 'x\n')
    const state = await readGit(root, Date.now() + 1)
    expect(state).toMatchObject({
      path: root,
      branch: 'main',
      detached: false,
      upstream: null,
      ahead: null,
      changed: 1,
      untracked: 1,
      head: { subject: 'first', author: 'Ada' },
    })
    expect(state?.files).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', status: 'U' },
    ])
    expect(state?.lastChangeAt).toBeGreaterThanOrEqual(state?.head?.at ?? 0)
  })

  it('has nothing for a folder that is not a repository, or is not a path', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'portta-plain-'))
    mkdirSync(join(plain, 'sub'))
    expect(await readGit(join(plain, 'sub'))).toBeNull()
    expect(await readGit('relative/path')).toBeNull()
    expect(await readGit('/does/not/exist')).toBeNull()
  })

  it('does not run what a repository asks it to run', async () => {
    const root = repository()
    const marker = join(root, 'ran')
    run(root, 'config', 'core.fsmonitor', `touch ${marker}`)
    await readGit(root, Date.now() + 100_000)
    expect(() => execFileSync('test', ['-e', marker])).toThrow()
  })
})
