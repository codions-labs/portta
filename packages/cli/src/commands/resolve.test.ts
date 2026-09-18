import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelClient } from '../api.js'
import { runProcess } from '../process.js'
import { resolvePath } from './resolve.js'

// The registry as `GET /projects` and `GET /projects/:slug` answer it.
interface Registered {
  slug: string
  repositories: Array<{ name: string; localPath?: string | null; remoteUrl?: string | null }>
}

function client(projects: Registered[], refuse = false): PanelClient {
  return {
    request: async (_method: string, path: string) => {
      if (refuse) {
        const { RefusedError } = await import('../errors.js')
        throw new RefusedError('not a member of this Project')
      }
      if (path === '/projects') return { projects: projects.map((p) => ({ slug: p.slug })) }
      const slug = decodeURIComponent(path.slice('/projects/'.length))
      const project = projects.find((p) => p.slug === slug)!
      return {
        id: `id-${project.slug}`,
        slug: project.slug,
        name: project.slug,
        resolvedPath: null,
        repositories: project.repositories.map((r, index) => ({
          id: `${project.slug}-${index}`,
          name: r.name,
          localPath: r.localPath ?? null,
          relativePath: null,
          remoteUrl: r.remoteUrl ?? null,
          scanPath: null,
        })),
      }
    },
  } as unknown as PanelClient
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const result = await runProcess('git', ['-C', cwd, ...args], {
    reject: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
}

let root: string
let repo: string
let worktree: string

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'portta-resolve-')))
  repo = join(root, 'shop')
  mkdirSync(join(repo, 'packages', 'api'), { recursive: true })
  await git(repo, 'init', '-q', '-b', 'main')
  await git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  await git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git')
  worktree = join(root, 'shop-issue-59')
  await git(repo, 'worktree', 'add', '-q', '-b', 'issue-59', worktree)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('portta projects resolve', () => {
  const registry = [
    {
      slug: 'shop',
      repositories: [{ name: 'shop', localPath: () => repo, remoteUrl: 'https://github.com/acme/shop' }],
    },
  ]
  const registered = () =>
    registry.map((p) => ({
      slug: p.slug,
      repositories: p.repositories.map((r) => ({ ...r, localPath: r.localPath() })),
    }))

  it('answers the same Project from the root, a subdirectory and a worktree', async () => {
    const fromRoot = await resolvePath(repo, client(registered()))
    const fromSubdirectory = await resolvePath(join(repo, 'packages', 'api'), client(registered()))
    const fromWorktree = await resolvePath(worktree, client(registered()))
    expect(fromRoot).toMatchObject({
      resolved: true,
      basis: 'root',
      certain: true,
      project: { slug: 'shop' },
      repository: { name: 'shop', path: repo },
      git: { branch: 'main' },
      worktree: null,
    })
    expect(fromSubdirectory).toMatchObject({
      resolved: true,
      basis: 'subdirectory',
      project: { slug: 'shop' },
      path: join(repo, 'packages', 'api'),
    })
    expect(fromWorktree).toMatchObject({
      resolved: true,
      basis: 'worktree',
      project: { slug: 'shop' },
      git: { branch: 'issue-59' },
      worktree: { path: worktree, mainPath: repo },
    })
  })

  it('reports absence instead of guessing', async () => {
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    const outcome = await resolvePath(elsewhere, client(registered()))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'unknown', candidates: [] } })
  })

  it('names both candidates on ambiguity and chooses neither', async () => {
    const twice = [
      ...registered(),
      { slug: 'shop-fork', repositories: [{ name: 'shop', localPath: repo, remoteUrl: null }] },
    ]
    const outcome = await resolvePath(repo, client(twice))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'ambiguous' } })
    expect(outcome.resolved === false && outcome.error.candidates.map((c) => c.slug).sort()).toEqual([
      'shop',
      'shop-fork',
    ])
  })

  it('tells a stale registration from absence when only the remote matches', async () => {
    const moved = [
      {
        slug: 'shop',
        repositories: [{ name: 'shop', localPath: join(root, 'gone'), remoteUrl: 'git@github.com:acme/shop.git' }],
      },
    ]
    const outcome = await resolvePath(repo, client(moved))
    expect(outcome).toMatchObject({
      resolved: false,
      error: { kind: 'stale', candidates: [{ slug: 'shop', basis: 'remote' }] },
    })
  })

  it('declares a remote-only match as inferred', async () => {
    const clone = join(root, 'shop-clone')
    await git(root, 'clone', '-q', repo, clone)
    await git(clone, 'remote', 'set-url', 'origin', 'git@github.com:acme/shop.git')
    const outcome = await resolvePath(clone, client(registered()))
    expect(outcome).toMatchObject({ resolved: true, basis: 'remote', certain: false, project: { slug: 'shop' } })
  })

  it('reports a refusal as unauthorized', async () => {
    const outcome = await resolvePath(repo, client([], true))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'unauthorized' } })
  })

  it('refuses a path that does not exist', async () => {
    await expect(resolvePath(join(root, 'nowhere'), client(registered()))).rejects.toThrow(/does not exist/)
  })
})
