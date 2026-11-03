import { execFileSync } from 'node:child_process'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileKey, type PublishedFiles } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { filesDir, publishFiles } from './files.js'

const identity = ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.test']
const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...identity, ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  })

let counter = 0
function project() {
  const folder = mkdtempSync(join(tmpdir(), 'portta-files-project-'))
  const root = mkdtempSync(join(tmpdir(), 'portta-files-root-'))
  run(folder, 'init', '-b', 'main')
  mkdirSync(join(folder, 'src'))
  writeFileSync(join(folder, 'src/app.ts'), 'export const one = 1\n')
  writeFileSync(join(folder, 'README.md'), '# Demo\n')
  writeFileSync(join(folder, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(folder, '.env'), 'TOKEN=super-secret-value\n')
  run(folder, 'add', '-f', '.')
  run(folder, 'commit', '-m', 'first')
  const environment = `demo-${counter++}`
  const read = async (): Promise<PublishedFiles> => {
    await publishFiles(root, environment, folder, Date.now() + counter * 100_000)
    return JSON.parse(readFileSync(join(filesDir(root), environment, 'index.json'), 'utf8')) as PublishedFiles
  }
  return { folder, root, environment, read }
}

const blobs = (root: string, environment: string) => {
  const dir = join(filesDir(root), environment, 'blobs')
  return readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'))
}

describe('the copy of a project’s files the panel reads', () => {
  it('lists what git lists, and shows the text of the ordinary ones', async () => {
    const { read, root, environment } = project()
    const index = await read()
    expect(index).toMatchObject({ environment, branch: 'main', changed: 0, head: { subject: 'first' } })
    const app = index.files.find((file) => file.path === 'src/app.ts')
    expect(app).toMatchObject({ readable: 'text', status: null })
    expect(readFileSync(join(filesDir(root), environment, 'blobs', fileKey('src/app.ts')), 'utf8')).toBe(
      'export const one = 1\n',
    )
  })

  it('lists a file that holds secrets and never copies a byte of it', async () => {
    const { read, root, environment } = project()
    const index = await read()
    expect(index.files.find((file) => file.path === '.env')).toMatchObject({ readable: 'hidden' })
    expect(existsSync(join(filesDir(root), environment, 'blobs', fileKey('.env')))).toBe(false)
    expect(blobs(root, environment).join('\n')).not.toContain('super-secret-value')
  })

  it('shows what changed against the last commit, and an untracked file as new', async () => {
    const { read, folder, root, environment } = project()
    writeFileSync(join(folder, 'src/app.ts'), 'export const one = 2\n')
    writeFileSync(join(folder, 'notes.md'), 'todo\n')
    const index = await read()
    expect(index).toMatchObject({ changed: 1, untracked: 1 })
    expect(index.files.find((file) => file.path === 'src/app.ts')).toMatchObject({ status: 'M', diff: true })
    expect(index.files.find((file) => file.path === 'notes.md')).toMatchObject({ status: 'U', diff: false })
    const patch = readFileSync(join(filesDir(root), environment, 'diffs', fileKey('src/app.ts')), 'utf8')
    expect(patch).toContain('-export const one = 1')
    expect(patch).toContain('+export const one = 2')
  })

  it('lists an ignored folder without looking inside it', async () => {
    const { read, folder, root, environment } = project()
    mkdirSync(join(folder, 'node_modules/left-pad'), { recursive: true })
    writeFileSync(join(folder, 'node_modules/left-pad/index.js'), 'module.exports = 1\n')
    const index = await read()
    expect(index.files.find((file) => file.path === 'node_modules')).toMatchObject({ kind: 'dir', ignored: true })
    expect(index.files.some((file) => file.path.startsWith('node_modules/'))).toBe(false)
    expect(blobs(root, environment).join('\n')).not.toContain('module.exports')
  })

  it('does not follow a link out of the folder', async () => {
    const { read, folder, root, environment } = project()
    const outside = mkdtempSync(join(tmpdir(), 'portta-outside-'))
    writeFileSync(join(outside, 'passwd'), 'root:x:0:0\n')
    symlinkSync(join(outside, 'passwd'), join(folder, 'escape.txt'))
    symlinkSync(outside, join(folder, 'escape-dir'))
    run(folder, 'add', '-f', 'escape.txt', 'escape-dir')
    const index = await read()
    expect(index.files.find((file) => file.path === 'escape.txt')?.readable).not.toBe('text')
    expect(index.files.find((file) => file.path === 'escape-dir')?.readable).not.toBe('text')
    expect(blobs(root, environment).join('\n')).not.toContain('root:x:0:0')
  })

  it('says a binary or a large file exists and shows nothing of it', async () => {
    const { read, folder } = project()
    writeFileSync(join(folder, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
    writeFileSync(join(folder, 'big.log'), 'x'.repeat(200 * 1024))
    const index = await read()
    expect(index.files.find((file) => file.path === 'logo.png')?.readable).toBe('binary')
    expect(index.files.find((file) => file.path === 'big.log')).toMatchObject({ readable: 'large', size: 200 * 1024 })
  })

  it('publishes nothing for a folder that is not a repository, and for a name that is not a folder name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-files-root-'))
    const plain = mkdtempSync(join(tmpdir(), 'portta-files-plain-'))
    await publishFiles(root, 'plain', plain, Date.now() + 1_000_000)
    await publishFiles(root, '../escape', plain, Date.now() + 2_000_000)
    expect(existsSync(join(filesDir(root), 'plain', 'index.json'))).toBe(false)
    expect(existsSync(join(root, 'state/escape'))).toBe(false)
  })

  it('keeps out what the owner excluded for themselves in .git/info/exclude', async () => {
    const { read, folder, root, environment } = project()
    writeFileSync(join(folder, 'local-notes.txt'), 'my private notes\n')
    writeFileSync(join(folder, '.git/info/exclude'), 'local-notes.txt\n')
    const index = await read()
    // Listed as ignored, like node_modules, and never read.
    expect(index.files.find((file) => file.path === 'local-notes.txt')).toMatchObject({
      ignored: true,
      readable: 'omitted',
    })
    expect(blobs(root, environment).join('\n')).not.toContain('my private notes')
  })

  it('takes a file name for a file name, not for a pattern that reaches other files', async () => {
    const { read, folder, root, environment } = project()
    writeFileSync(join(folder, 'src/lone*.ts'), 'one\n')
    run(folder, 'add', '-f', 'src/lone*.ts', 'src')
    run(folder, 'commit', '-m', 'second')
    writeFileSync(join(folder, 'src/lone*.ts'), 'two\n')
    writeFileSync(join(folder, 'src/app.ts'), 'export const one = 99999\n')
    await read()
    const patches = readdirSync(join(filesDir(root), environment, 'diffs')).map((name) =>
      readFileSync(join(filesDir(root), environment, 'diffs', name), 'utf8'),
    )
    const star = patches.find((patch) => patch.includes('lone*.ts')) ?? ''
    expect(star).not.toContain('99999')
  })

  it('does not read a file that has another name, which could lead out of the folder', async () => {
    const { read, folder, root, environment } = project()
    const outside = mkdtempSync(join(tmpdir(), 'portta-outside-'))
    writeFileSync(join(outside, 'shadow'), 'root:$6$hash\n')
    try {
      linkSync(join(outside, 'shadow'), join(folder, 'hard.txt'))
    } catch {
      return
    }
    const index = await read()
    expect(index.files.find((file) => file.path === 'hard.txt')?.readable).not.toBe('text')
    expect(blobs(root, environment).join('\n')).not.toContain('root:$6$')
  })
})
