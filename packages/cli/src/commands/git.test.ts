import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inspectContainers: vi.fn() }))
vi.mock('../docker.js', () => ({ inspectContainers: mocks.inspectContainers }))

import { collectGitProject } from './git.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.inspectContainers.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-git-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test Person'])
  writeFileSync(join(root, 'README.md'), 'hello\n')
  execFileSync('git', ['-C', root, 'add', 'README.md'])
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'Add invoice totals'])
  return root
}

describe('Git collection', () => {
  it('collects metadata and never file contents', async () => {
    const root = repository()
    writeFileSync(join(root, '.env'), 'SECRET=hunter2\n')
    const record = await collectGitProject('demo', root, 'owner/repo')
    const git = record.git as Record<string, unknown>
    expect(git.branch).toBe('main')
    expect((git.head as Record<string, unknown>).subject).toBe('Add invoice totals')
    expect(git.untracked).toBe(1)
    expect(JSON.stringify(record)).not.toContain('hunter2')
  })
  it('reports a normal non-repository absence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-plain-'))
    roots.push(root)
    expect((await collectGitProject('plain', root)).reason).toBe('not a git repository')
  })
})
