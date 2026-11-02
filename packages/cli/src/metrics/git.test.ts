import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGit, workingDirectories } from './git.js'

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

describe('a repository that names a command is not read', () => {
  async function refused(configure: (root: string, marker: string) => void) {
    const root = repository()
    const marker = join(root, 'ran')
    configure(root, marker)
    const state = await readGit(root, Date.now() + 10_000_000)
    return { state, ran: existsSync(marker) }
  }

  it('a clean filter', async () => {
    const { state, ran } = await refused((root, marker) => {
      writeFileSync(join(root, '.gitattributes'), 'a.txt filter=evil\n')
      run(root, 'config', 'filter.evil.clean', `touch ${marker}; cat`)
      writeFileSync(join(root, 'a.txt'), 'changed\n')
    })
    expect(state).toBeNull()
    expect(ran).toBe(false)
  })

  it('a signature program', async () => {
    const { state, ran } = await refused((root, marker) => {
      run(root, 'config', 'gpg.program', `touch ${marker}`)
      run(root, 'config', 'log.showSignature', 'true')
    })
    expect(state).toBeNull()
    expect(ran).toBe(false)
  })

  it('an included file', async () => {
    const { state } = await refused((root) => run(root, 'config', 'include.path', '../elsewhere'))
    expect(state).toBeNull()
  })
})

describe('which folder a project was started from', () => {
  const root = mkdtempSync(join(tmpdir(), 'portta-root-'))
  const mine = mkdtempSync(join(tmpdir(), 'portta-mine-'))
  const labels = (project: string, directory: string) => ({
    labels: { 'com.docker.compose.project': project, 'com.docker.compose.project.working_dir': directory },
  })

  it('takes the folder when every container of the project agrees', () => {
    expect(workingDirectories([labels('a', mine), labels('a', mine)], root).get('a')).toBeTruthy()
  })

  it('takes none when the containers disagree, or the path is not absolute', () => {
    const other = mkdtempSync(join(tmpdir(), 'portta-other-'))
    expect(workingDirectories([labels('a', mine), labels('a', other)], root).has('a')).toBe(false)
    expect(workingDirectories([labels('b', 'relative/dir')], root).has('b')).toBe(false)
  })

  it("takes none inside Portta's own installation, through a link as well", () => {
    const inside = join(root, 'state')
    mkdirSync(inside)
    const link = join(mine, 'link')
    symlinkSync(inside, link)
    expect(workingDirectories([labels('c', inside)], root).has('c')).toBe(false)
    expect(workingDirectories([labels('d', link)], root).has('d')).toBe(false)
  })

  it('takes none for a folder the collector does not own', () => {
    expect(workingDirectories([labels('e', mine)], root, (process.getuid?.() ?? 0) + 1).has('e')).toBe(false)
  })
})
