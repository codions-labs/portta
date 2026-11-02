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
  resolvedPath: string | null
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
      return { id: `id-${project.slug}`, slug: project.slug, name: project.slug, resolvedPath: project.resolvedPath }
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
  worktree = join(root, 'shop-issue-59')
  await git(repo, 'worktree', 'add', '-q', '-b', 'issue-59', worktree)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('portta projects resolve', () => {
  const registered = (): Registered[] => [{ slug: 'shop', resolvedPath: repo }]

  it('answers the same Project from the root, a subdirectory and a worktree', async () => {
    const fromRoot = await resolvePath(repo, client(registered()))
    const fromSubdirectory = await resolvePath(join(repo, 'packages', 'api'), client(registered()))
    const fromWorktree = await resolvePath(worktree, client(registered()))
    expect(fromRoot).toMatchObject({
      resolved: true,
      basis: 'root',
      project: { slug: 'shop', path: repo },
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
      worktree: { path: worktree, mainPath: repo },
    })
  })

  it('reports absence instead of guessing', async () => {
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    const outcome = await resolvePath(elsewhere, client(registered()))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'unknown', candidates: [] } })
  })

  it('lets the deepest Project directory win when Projects nest', async () => {
    const nested = [...registered(), { slug: 'api', resolvedPath: join(repo, 'packages', 'api') }]
    expect(await resolvePath(join(repo, 'packages', 'api'), client(nested))).toMatchObject({
      resolved: true,
      basis: 'root',
      project: { slug: 'api' },
    })
    expect(await resolvePath(repo, client(nested))).toMatchObject({ resolved: true, project: { slug: 'shop' } })
  })

  it('names both candidates on a tie and chooses neither', async () => {
    const twice = [...registered(), { slug: 'shop-fork', resolvedPath: repo }]
    const outcome = await resolvePath(repo, client(twice))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'ambiguous' } })
    expect(outcome.resolved === false && outcome.error.candidates.map((c) => c.slug).sort()).toEqual([
      'shop',
      'shop-fork',
    ])
  })

  it('ignores a Project whose directory is not on this host', async () => {
    const outcome = await resolvePath(repo, client([{ slug: 'shop', resolvedPath: join(root, 'gone') }]))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'unknown' } })
  })

  it('reports a refusal as unauthorized', async () => {
    const outcome = await resolvePath(repo, client([], true))
    expect(outcome).toMatchObject({ resolved: false, error: { kind: 'unauthorized' } })
  })

  it('refuses a path that does not exist', async () => {
    await expect(resolvePath(join(root, 'nowhere'), client(registered()))).rejects.toThrow(/does not exist/)
  })
})
