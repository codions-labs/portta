import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectGit } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { readProjectGit } from '../src/services/git.ts'
import { FULL_HOST } from './fixtures.ts'
import { makeApp, testConfig } from './helpers.ts'

const NOW = 1_800_000_000_000

function collected(body: unknown, project = 'alpha'): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'portta-git-'))
  const key = 'abcdef012345'
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({ version: 1, collectedAt: NOW / 1000, environments: { [project]: key }, repositories: [] }),
  )
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(body))
  return { dir }
}

const FULL = {
  project: 'alpha',
  workingDir: '/srv/dev/alpha',
  collectedAt: NOW / 1000 - 120,
  git: {
    branch: 'feature/59-invoices',
    detached: false,
    head: {
      sha: '9f2c1abfeed1234567890abcdef1234567890abc',
      shortSha: '9f2c1ab',
      subject: 'Add invoice totals',
      author: 'Someone',
      date: NOW / 1000 - 3600,
    },
    staged: 2,
    unstaged: 5,
    untracked: 1,
    unmerged: 0,
    dirty: true,
    upstream: 'origin/feature/59-invoices',
    ahead: 3,
    behind: 0,
    remote: 'git@github.com:owner/repo.git',
  },
}

describe('reading what the host collected', () => {
  it('reports the branch, HEAD and working tree, with links derived from the remote', () => {
    const { dir } = collected(FULL)
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)

    expect(result.collected).toBe(true)
    expect(result.git?.branch).toBe('feature/59-invoices')
    expect(result.git?.ahead).toBe(3)
    expect(result.remote?.slug).toBe('owner/repo')
    expect(result.links.repo).toBe('https://github.com/owner/repo')
    expect(result.links.commit).toContain('/commit/9f2c1abfeed')
    expect(result.links.branch).toBe('https://github.com/owner/repo/tree/feature/59-invoices')
  })

  it('reports the age, and marks a scan past the threshold as stale', () => {
    const fresh = readProjectGit(testConfig({ gitDir: collected(FULL).dir }), 'alpha', NOW)
    expect(fresh.ageSeconds).toBe(120)
    expect(fresh.stale).toBe(false)

    const old = collected({ ...FULL, collectedAt: NOW / 1000 - 4000 })
    const result = readProjectGit(testConfig({ gitDir: old.dir }), 'alpha', NOW)
    expect(result.stale).toBe(true)
    expect(result.refreshCommand).toBe('./bin/portta repos scan --environment alpha')
  })

  it('says nothing was collected rather than inventing a state', () => {
    const result = readProjectGit(testConfig({ gitDir: mkdtempSync(join(tmpdir(), 'portta-git-')) }), 'alpha', NOW)
    expect(result.collected).toBe(false)
    expect(result.git).toBeNull()
    expect(result.refreshCommand).toContain('repos scan')
  })
})

describe('every absence renders as fewer fields, never an error', () => {
  it('a project with no Git at all', () => {
    const { dir } = collected({
      project: 'alpha',
      workingDir: '/srv/dev/alpha',
      collectedAt: NOW / 1000,
      git: null,
      reason: 'not a git repository',
    })
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.collected).toBe(true)
    expect(result.git).toBeNull()
    expect(result.reason).toBe('not a git repository')
  })

  it('a repository with no remote keeps the branch and loses the links', () => {
    const { dir } = collected({ ...FULL, git: { ...FULL.git, remote: null, upstream: null, ahead: 0 } })
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.git?.branch).toBe('feature/59-invoices')
    expect(result.remote).toBeNull()
    expect(result.links).toEqual({ repo: null, commit: null, branch: null })
  })

  it('a detached HEAD says so instead of naming a branch', () => {
    const { dir } = collected({ ...FULL, git: { ...FULL.git, branch: null, detached: true } })
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.git?.detached).toBe(true)
    expect(result.git?.branch).toBeNull()
    expect(result.links.branch).toBeNull()
  })

  it('a non-GitHub remote keeps the repository link and drops the commit one', () => {
    const { dir } = collected({
      ...FULL,
      git: { ...FULL.git, remote: 'git@git.acme.dev:owner/repo.git' },
    })
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.links.repo).toBe('https://git.acme.dev/owner/repo')
    expect(result.links.commit).toBeNull()
  })

  it('a file that is not JSON', () => {
    const { dir } = collected(null)
    writeFileSync(join(dir, 'abcdef012345.json'), 'this is not json')
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.collected).toBe(false)
    expect(result.reason).toContain('could not be read')
  })

  it('a file whose shape is wrong entirely', () => {
    const { dir } = collected({ collectedAt: 'yesterday', git: 'a branch, probably' })
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.git).toBeNull()
    expect(result.collectedAt).toBeNull()
  })
})

describe('the file name comes from the project, and cannot leave the directory', () => {
  it('refuses a name that walks a path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-git-'))
    for (const name of ['../../.env', 'a/b', '.hidden', '']) {
      expect(readProjectGit(testConfig({ gitDir: dir }), name, NOW).collected).toBe(false)
    }
  })
})

describe('GET /api/environments/:project/git', () => {
  it('answers for a running project', async () => {
    const { dir } = collected(FULL)
    const { app } = makeApp({ containers: FULL_HOST }, { gitDir: dir })
    const response = await app.request('/api/environments/alpha/git')
    expect(response.status).toBe(200)
    expect(((await response.json()) as ProjectGit).git?.branch).toBe('feature/59-invoices')
  })

  it('answers 200 with nothing collected, not 404, for a project nobody scanned', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, { gitDir: mkdtempSync(join(tmpdir(), 'portta-git-')) })
    const response = await app.request('/api/environments/beta/git')
    expect(response.status).toBe(200)
    expect(((await response.json()) as ProjectGit).collected).toBe(false)
  })

  it('404s for a project that is not running', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, { gitDir: collected(FULL).dir })
    expect((await app.request('/api/environments/nope/git')).status).toBe(404)
  })
})

describe('the repository scan index', () => {
  it('maps an environment to the repository file the collector wrote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-git-'))
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({
        version: 1,
        collectedAt: NOW / 1000 - 30,
        environments: { alpha: 'abcdef012345', bogus: '../etc' },
      }),
    )
    writeFileSync(
      join(dir, 'abcdef012345.json'),
      JSON.stringify({
        ...FULL,
        project: undefined,
        workingDir: undefined,
        path: '/srv/projects/alpha',
        key: 'abcdef012345',
      }),
    )
    const result = readProjectGit(testConfig({ gitDir: dir }), 'alpha', NOW)
    expect(result.collected).toBe(true)
    expect(result.workingDir).toBe('/srv/projects/alpha')
    expect(result.git?.branch).toBe('feature/59-invoices')
    expect(readProjectGit(testConfig({ gitDir: dir }), 'bogus', NOW).collected).toBe(false)
  })
})
