import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('a work tree somewhere else than the folder it was asked about', async () => {
    const { state } = await refused((root) => run(root, 'config', 'core.worktree', '/'))
    expect(state).toBeNull()
  })

  it('a bare repository', async () => {
    const { state } = await refused((root) => run(root, 'config', 'core.bare', 'true'))
    expect(state).toBeNull()
  })

  it('a linked work tree, whose repository lives in another folder', async () => {
    const root = repository()
    const linked = mkdtempSync(join(tmpdir(), 'portta-linked-'))
    rmSync(linked, { recursive: true })
    run(root, 'worktree', 'add', linked)
    expect(await readGit(linked, Date.now() + 1)).toBeNull()
  })

  it('a filter hidden behind a tab in the name of its section', async () => {
    const { state, ran } = await refused((root, marker) => {
      appendFileSync(join(root, '.git', 'config'), `[filter "a\tb"]\n\tclean = touch ${marker}\n`)
      writeFileSync(join(root, '.gitattributes'), '* filter=a\tb\n')
    })
    expect(state).toBeNull()
    expect(ran).toBe(false)
  })

  it('a configuration that is a link, or too large', async () => {
    const root = repository()
    const config = join(root, '.git', 'config')
    appendFileSync(config, `# ${'x'.repeat(70_000)}\n`)
    expect(await readGit(root, Date.now() + 1)).toBeNull()
    const other = repository()
    rmSync(join(other, '.git', 'config'))
    symlinkSync(config, join(other, '.git', 'config'))
    expect(await readGit(other, Date.now() + 1)).toBeNull()
  })

  it('an included file', async () => {
    const { state } = await refused((root) => run(root, 'config', 'include.path', '../elsewhere'))
    expect(state).toBeNull()
  })
})

describe('which folder a project was started from', () => {
  const root = mkdtempSync(join(tmpdir(), 'portta-root-'))
  const mine = mkdtempSync(join(tmpdir(), 'portta-mine-'))
  const labels = (project: string, directory: string, files = [join(directory, 'compose.yaml')]) => ({
    labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.project.working_dir': directory,
      'com.docker.compose.project.config_files': files.join(','),
    },
  })
  writeFileSync(join(mine, 'compose.yaml'), 'services: {}\n')

  it('takes the folder when every container of the project agrees', () => {
    expect(workingDirectories([labels('a', mine), labels('a', mine)], root).get('a')).toBeTruthy()
  })

  it('takes the folder of a project that was adopted, whose files include the overlay Portta wrote', () => {
    const overlays = join(root, 'runtime', 'compose', 'abc123')
    mkdirSync(overlays, { recursive: true })
    const overlay = join(overlays, 'compose.portta.yaml')
    writeFileSync(overlay, 'services: {}\n')
    const adopted = labels('adopted', mine, [join(mine, 'compose.yaml'), overlay])
    expect(workingDirectories([adopted], root).get('adopted')).toBeTruthy()
  })

  it('does not believe an overlay that is somewhere else, or a project that names only overlays', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'portta-elsewhere-'))
    const forged = join(elsewhere, 'compose.portta.yaml')
    writeFileSync(forged, 'services: {}\n')
    expect(workingDirectories([labels('f', mine, [join(mine, 'compose.yaml'), forged])], root).has('f')).toBe(false)
    const overlays = join(root, 'runtime', 'compose', 'only')
    mkdirSync(overlays, { recursive: true })
    writeFileSync(join(overlays, 'compose.portta.yaml'), 'services: {}\n')
    expect(workingDirectories([labels('g', mine, [join(overlays, 'compose.portta.yaml')])], root).has('g')).toBe(false)
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

  it('takes none for a folder that two projects both name', () => {
    const both = workingDirectories([labels('j', mine), labels('k', mine)], root)
    expect(both.has('j') || both.has('k')).toBe(false)
  })

  it('counts a folder by where its name leads, through a link or a trailing slash', () => {
    const alias = join(root, 'alias-of-mine')
    symlinkSync(mine, alias)
    expect(workingDirectories([labels('l', mine), labels('m', alias, [join(mine, 'compose.yaml')])], root).size).toBe(0)
    expect(
      workingDirectories([labels('n', mine), labels('o', `${mine}/`, [join(mine, 'compose.yaml')])], root).size,
    ).toBe(0)
  })

  it('takes none when Compose did not read a file in that folder', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'portta-elsewhere-'))
    writeFileSync(join(elsewhere, 'compose.yaml'), 'services: {}\n')
    expect(workingDirectories([labels('f', mine, [join(elsewhere, 'compose.yaml')])], root).has('f')).toBe(false)
    expect(workingDirectories([labels('g', mine, [join(mine, 'missing.yaml')])], root).has('g')).toBe(false)
    expect(workingDirectories([labels('h', mine, [])], root).has('h')).toBe(false)
  })

  it('takes none where the collector cannot tell who it runs as', () => {
    expect(workingDirectories([labels('i', mine)], root, null).size).toBe(0)
  })

  it('takes none for a folder the collector does not own', () => {
    expect(workingDirectories([labels('e', mine)], root, (process.getuid?.() ?? 0) + 1).has('e')).toBe(false)
  })
})
