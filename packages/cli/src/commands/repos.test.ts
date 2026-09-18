import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { INSTRUCTION_MAX_BYTES, repositoryKey } from 'portta-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Output } from '../output.js'

const mocks = vi.hoisted(() => ({ inspectContainers: vi.fn(), root: '', env: {} as Record<string, string> }))
vi.mock('../docker.js', () => ({ inspectContainers: mocks.inspectContainers }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: mocks.root,
    env: { ...process.env, ...mocks.env },
    config: {},
    composeFiles: [],
    version: 'test',
  }),
}))

import { collectInstructions, collectSpecifications, refreshRepositories, scanRepositories } from './repos.js'

const dirs: string[] = []
// No test here talks to a real panel: the default is a panel that does not answer.
beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('connection refused')
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.inspectContainers.mockReset()
  mocks.env = {}
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A panel with one Project and the repositories it registered. */
function stubPanel(repositories: Array<{ localPath: string | null }>, status = 200): { urls: string[] } {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url)
    const body = url.endsWith('/api/projects') ? { projects: [{ slug: 'hub' }] } : { repositories }
    return new Response(JSON.stringify(status === 200 ? body : { error: 'no database' }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { urls }
}

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function repository(root: string, subjects = ['Add invoice totals']): string {
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test Person'])
  writeFileSync(join(root, 'README.md'), 'hello\n')
  execFileSync('git', ['-C', root, 'add', 'README.md'])
  for (const subject of subjects) execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', subject])
  return root
}

function gateway(): string {
  const root = temp('portta-root-')
  mocks.root = root
  return root
}

describe('instruction files', () => {
  it('reads the allowlist, marks dirty ones, and never a .env', async () => {
    const root = repository(temp('portta-repo-'))
    writeFileSync(join(root, 'AGENTS.md'), '# Rules\n')
    writeFileSync(join(root, '.env'), 'SECRET=hunter2\n')
    mkdirSync(join(root, '.cursor/rules'), { recursive: true })
    writeFileSync(join(root, '.cursor/rules/style.mdc'), 'style\n')
    writeFileSync(join(root, '.cursor/rules/notes.txt'), 'not a rule\n')
    execFileSync('git', ['-C', root, 'add', 'AGENTS.md'])
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'Add agents file'])
    writeFileSync(join(root, 'AGENTS.md'), '# Rules, edited\n')

    const files = await collectInstructions(root)
    expect(files.map((file) => file.path)).toEqual(['AGENTS.md', '.cursor/rules/style.mdc'])
    expect(files[0]).toMatchObject({ audience: 'any', dirty: true, truncated: false, content: '# Rules, edited\n' })
    expect(files[1]).toMatchObject({ audience: 'cursor', dirty: true })
    expect(JSON.stringify(files)).not.toContain('hunter2')
  })

  it('keeps the metadata and drops the content of a file over the bound', async () => {
    const root = repository(temp('portta-repo-'))
    writeFileSync(join(root, 'CLAUDE.md'), 'x'.repeat(INSTRUCTION_MAX_BYTES + 1))
    const [file] = await collectInstructions(root)
    expect(file).toMatchObject({
      path: 'CLAUDE.md',
      truncated: true,
      content: null,
      sizeBytes: INSTRUCTION_MAX_BYTES + 1,
    })
  })
})

describe('specification references', () => {
  it('lists decision records and framework trees as references, attributing a specs tree only beside its marker', async () => {
    const root = repository(temp('portta-repo-'))
    mkdirSync(join(root, 'docs/development/adr'), { recursive: true })
    writeFileSync(join(root, 'docs/development/adr/0001-first.md'), '# 0001. First decision\n\nbody\n')
    writeFileSync(join(root, 'docs/development/adr/README.md'), '# Index\n')
    mkdirSync(join(root, 'openspec/changes/add-login'), { recursive: true })
    writeFileSync(join(root, 'openspec/changes/add-login/proposal.md'), '---\ntitle: Add login\n---\n')
    writeFileSync(join(root, 'openspec/changes/add-login/notes.md'), 'scratch\n')
    mkdirSync(join(root, 'specs/001-login'), { recursive: true })
    writeFileSync(join(root, 'specs/001-login/spec.md'), '# Login\n')
    writeFileSync(join(root, 'docs/development/adr/.env'), 'SECRET=hunter2\n')
    execFileSync('git', ['-C', root, 'add', 'docs', 'openspec', 'specs'])
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'Add documents'])
    writeFileSync(join(root, 'docs/development/adr/0001-first.md'), '# 0001. First decision, amended\n')

    const before = await collectSpecifications(root)
    expect(before.map((reference) => reference.path)).toEqual([
      'docs/development/adr/0001-first.md',
      'openspec/changes/add-login/proposal.md',
    ])
    expect(before[0]).toMatchObject({
      provider: 'adr',
      kind: 'decision',
      title: '0001. First decision, amended',
      dirty: true,
    })
    expect(before[1]).toMatchObject({ provider: 'openspec', kind: 'change', title: 'Add login', dirty: false })
    expect(JSON.stringify(before)).not.toContain('hunter2')
    expect(JSON.stringify(before)).not.toContain('body')

    mkdirSync(join(root, '.specify/memory'), { recursive: true })
    writeFileSync(join(root, '.specify/memory/constitution.md'), '# Constitution\n')
    const after = await collectSpecifications(root)
    expect(after.map((reference) => `${reference.provider}:${reference.path}`)).toEqual([
      'spec-kit:.specify/memory/constitution.md',
      'adr:docs/development/adr/0001-first.md',
      'openspec:openspec/changes/add-login/proposal.md',
      'spec-kit:specs/001-login/spec.md',
    ])
  })

  it('is empty, and well formed, for a repository without any', async () => {
    expect(await collectSpecifications(repository(temp('portta-repo-')))).toEqual([])
  })
})

describe('scanRepositories', () => {
  it('keys by repository root, maps environments, and lists recent commits', async () => {
    const gatewayRoot = gateway()
    const repo = repository(temp('portta-repo-'), ['one', 'two', 'three'])
    mkdirSync(join(repo, 'deploy'))
    mocks.inspectContainers.mockResolvedValue([
      {
        labels: {
          'com.docker.compose.project': 'shop',
          'com.docker.compose.project.working_dir': join(repo, 'deploy'),
        },
      },
      { labels: { 'com.docker.compose.project': 'shop-pr7', 'com.docker.compose.project.working_dir': repo } },
      {
        labels: { 'com.docker.compose.project': 'ghost', 'com.docker.compose.project.working_dir': '/nowhere/at/all' },
      },
    ])

    const result = await scanRepositories({})
    expect(result.repositories).toHaveLength(1)
    const [scan] = result.repositories
    expect(scan!.key).toBe(repositoryKey(scan!.path))
    expect(scan!.environments).toEqual(['shop', 'shop-pr7'])
    expect(scan!.commits.map((commit) => commit.subject)).toEqual(['three', 'two', 'one'])
    expect(scan!.git?.branch).toBe('main')
    expect(result.index.environments).toEqual({ shop: scan!.key, 'shop-pr7': scan!.key })

    const file = join(gatewayRoot, 'state/git', `${scan!.key}.json`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(join(gatewayRoot, 'state/git/index.json'), 'utf8')).version).toBe(1)
  })

  it('discovers the first level of Projects Home and classifies it as managed', async () => {
    gateway()
    const home = temp('portta-home-')
    repository(join(home, 'alpha')) // mkdir happens through git init
    mkdirSync(join(home, 'not-a-repo'))
    mkdirSync(join(home, '.hidden'))
    mocks.env = { PORTTA_PROJECTS_HOME: home }
    mocks.inspectContainers.mockRejectedValue(new Error('no docker'))

    const result = await scanRepositories({})
    expect(result.repositories.map((scan) => scan.name)).toEqual(['alpha'])
    expect(result.index.repositories[0]).toMatchObject({ name: 'alpha', location: 'managed', relativePath: 'alpha' })
    expect(result.index.home).toBeTruthy()
  })

  it('descends one level into a workspace directory, and no further', async () => {
    gateway()
    const home = temp('portta-home-')
    repository(join(home, 'alpha'))
    mkdirSync(join(home, 'workspace'))
    repository(join(home, 'workspace', 'one'))
    repository(join(home, 'workspace', 'two'))
    repository(join(home, 'workspace', '.hidden'))
    mkdirSync(join(home, 'workspace', 'plain'))
    mkdirSync(join(home, 'workspace', 'deeper'))
    repository(join(home, 'workspace', 'deeper', 'three'))
    writeFileSync(join(home, 'workspace', 'notes.txt'), 'not a directory\n')
    mocks.env = { PORTTA_PROJECTS_HOME: home }
    mocks.inspectContainers.mockRejectedValue(new Error('no docker'))

    const result = await scanRepositories({})
    expect(result.index.repositories.map((entry) => [entry.name, entry.location, entry.relativePath])).toEqual([
      ['alpha', 'managed', 'alpha'],
      ['one', 'managed', 'workspace/one'],
      ['two', 'managed', 'workspace/two'],
    ])
  }, 15_000)

  it('collects the paths the panel registered, even where the Home walk does not look', async () => {
    gateway()
    const home = temp('portta-home-')
    repository(join(home, 'BrasilDataHub'))
    repository(join(home, 'BrasilDataHub', '.github')) // its own clone, in a hidden directory
    const outside = repository(temp('portta-outside-'))
    const { urls } = stubPanel([
      { localPath: join(home, 'BrasilDataHub', '.github') },
      { localPath: outside },
      { localPath: '/nowhere/at/all' },
      { localPath: null },
    ])
    mocks.env = { PORTTA_PROJECTS_HOME: home, PORTTA_WEB_PORT: '8081' }
    mocks.inspectContainers.mockRejectedValue(new Error('no docker'))

    const result = await scanRepositories({})
    expect(result.repositories.map((scan) => scan.name).sort()).toEqual(
      ['.github', 'BrasilDataHub', basename(outside)].sort(),
    )
    expect(result.index.repositories.find((entry) => entry.name === '.github')).toMatchObject({
      location: 'managed',
      relativePath: null,
      path: realpathSync(join(home, 'BrasilDataHub', '.github')),
    })
    expect(urls).toEqual(['http://127.0.0.1:8081/api/projects', 'http://127.0.0.1:8081/api/projects/hub/repositories'])
  }, 15_000)

  it('goes on without the panel, and says so only when asked', async () => {
    gateway()
    const home = temp('portta-home-')
    repository(join(home, 'alpha'))
    mocks.env = { PORTTA_PROJECTS_HOME: home }
    mocks.inspectContainers.mockRejectedValue(new Error('no docker'))

    let stderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk)
      return true
    })
    const refused = await scanRepositories({}, undefined, new Output({ verbose: true }))
    expect(refused.repositories.map((scan) => scan.name)).toEqual(['alpha'])
    expect(stderr).toContain('registered repositories skipped')

    stubPanel([], 503)
    const down = await scanRepositories({})
    expect(down.repositories.map((scan) => scan.name)).toEqual(['alpha'])

    // A targeted scan never asks the panel at all.
    const { urls } = stubPanel([])
    await scanRepositories({ path: join(home, 'alpha') })
    expect(urls).toEqual([])
  }, 15_000)

  it('a targeted scan keeps what the full scan knew', async () => {
    const gatewayRoot = gateway()
    const repo = repository(temp('portta-repo-'))
    const other = repository(temp('portta-other-'))
    mocks.inspectContainers.mockResolvedValue([
      { labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': repo } },
      { labels: { 'com.docker.compose.project': 'other', 'com.docker.compose.project.working_dir': other } },
    ])
    await scanRepositories({})
    const partial = await scanRepositories({ environment: 'shop' })
    expect(partial.repositories).toHaveLength(1)
    expect(Object.keys(partial.index.environments).sort()).toEqual(['other', 'shop'])
    expect(partial.index.repositories).toHaveLength(2)
    expect(existsSync(join(gatewayRoot, 'state/git', `${repositoryKey(realpathSync(other))}.json`))).toBe(true)
  }, 15_000)

  it('refuses a --path outside a work tree', async () => {
    gateway()
    mocks.inspectContainers.mockResolvedValue([])
    await expect(scanRepositories({ path: temp('portta-plain-') })).rejects.toThrow(/not inside a git work tree/)
  })

  it('keeps an automatic refresh non-fatal, but reports why it failed', async () => {
    mocks.root = '/nonexistent/portta'
    mocks.inspectContainers.mockResolvedValue([])
    let stderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk)
      return true
    })
    await expect(refreshRepositories(undefined, new Output())).resolves.toBeUndefined()
    expect(stderr).toContain('repository metadata could not be refreshed')
  })
})
