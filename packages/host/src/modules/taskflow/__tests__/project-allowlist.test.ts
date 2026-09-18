import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizeFsPath } from '../adapters/git.ts'
import {
  assertProjectRootAllowed,
  isPathInsideAllowlist,
  loadProjectAllowlist,
  ProjectAllowlistError,
  registerableProjectRoot,
} from '../services/project-allowlist.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return canonicalizeFsPath(dir)
}

describe('loadProjectAllowlist', () => {
  it('parses colon/comma lists and falls back to provided roots', () => {
    expect(loadProjectAllowlist({ spec: '', fallbackRoots: ['/home/op'] }).map((p) => canonicalizeFsPath(p))).toEqual([
      canonicalizeFsPath('/home/op'),
    ])
    const loaded = loadProjectAllowlist({ spec: '/a:/b,/c;/d', fallbackRoots: ['/home/op'] })
    expect(loaded).toEqual(['/a', '/b', '/c', '/d'].map((p) => canonicalizeFsPath(p)))
  })
})

describe('assertProjectRootAllowed', () => {
  it('accepts a canonical root inside the allowlist and rejects outside', async () => {
    const allowed = await tempDir('tf-allow-')
    const other = await tempDir('tf-other-')
    const nested = join(allowed, 'repo')
    await mkdir(nested)

    expect(assertProjectRootAllowed(nested, [allowed])).toBe(canonicalizeFsPath(nested))
    expect(() => assertProjectRootAllowed(other, [allowed])).toThrow(ProjectAllowlistError)
  })

  it('rejects path traversal that escapes the allowlist', async () => {
    const allowed = await tempDir('tf-trav-')
    await mkdir(join(allowed, 'repo'))
    const escaped = join(allowed, 'repo', '..', '..')
    expect(() => assertProjectRootAllowed(escaped, [allowed])).toThrow(ProjectAllowlistError)
  })

  it('follows a symlink out of the allowlist and refuses the real path', async () => {
    const allowed = await tempDir('tf-link-src-')
    const secret = await tempDir('tf-link-dst-')
    await writeFile(join(secret, 'id'), 'nope\n')
    const link = join(allowed, 'escape')
    await symlink(secret, link)

    expect(isPathInsideAllowlist(link, [allowed])).toBe(false)
    expect(() => assertProjectRootAllowed(link, [allowed])).toThrow(ProjectAllowlistError)
    expect(assertProjectRootAllowed(link, [secret])).toBe(canonicalizeFsPath(secret))
  })
})

describe('registerableProjectRoot', () => {
  it('canonicalizes a git root, enforces the allowlist, and never implies execution', async () => {
    const allowed = await tempDir('tf-reg-')
    const repo = join(allowed, 'app')
    await mkdir(repo)
    const root = registerableProjectRoot(repo, {
      isGitRepo: (path) => path === repo,
      resolveRoot: (path) => path,
      allowlist: [allowed],
    })
    expect(root).toBe(canonicalizeFsPath(repo))

    const other = await tempDir('tf-reg-other-')
    expect(() =>
      registerableProjectRoot(repo, {
        isGitRepo: () => true,
        resolveRoot: (path) => path,
        allowlist: [other],
      }),
    ).toThrow(ProjectAllowlistError)

    expect(() =>
      registerableProjectRoot(repo, {
        isGitRepo: () => false,
        resolveRoot: (path) => path,
        allowlist: [allowed],
      }),
    ).toThrow(/Not a git repository/)
  })
})
