import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { promisify } from 'node:util'
import {
  createWorktree,
  findGitRoot,
  teardownWorktree,
  type Worktree,
} from '../../../../src/modules/taskflow/workflows/runtime/worktree.ts'

const exec = promisify(execFile)
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout.trim()
}

let root: string
let repo: string

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(join(root, 'repo-'))
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 't@t.t'])
  await git(dir, ['config', 'user.name', 't'])
  await git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'init'])
  // ensure a stable default branch name
  await git(dir, ['branch', '-M', 'main']).catch(() => {})
  return dir
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'taskflow-wt-'))
  repo = await makeRepo()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

test('findGitRoot returns the toplevel for a repo, null outside one', async () => {
  const top = await findGitRoot(repo)
  assert.equal(top, await git(repo, ['rev-parse', '--show-toplevel']))
  const nonRepo = mkdtempSync(join(root, 'plain-'))
  assert.equal(await findGitRoot(nonRepo), null)
})

test('createWorktree makes a locked worktree on a fresh branch and records the base', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run1', index: 0 })
  assert.ok(existsSync(wt.path))
  assert.equal(wt.branch, 'aw/run1-0')
  const head = await git(repo, ['rev-parse', 'HEAD'])
  assert.equal(wt.base, head)
  // base recorded in the worktree's own config
  assert.equal(await git(wt.path, ['config', '--get', 'taskflow.base']), head)
  // checked out on the expected branch
  assert.equal(await git(wt.path, ['rev-parse', '--abbrev-ref', 'HEAD']), 'aw/run1-0')
})

test('createWorktree links the worktree relatively so Git keeps working inside a container', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'rel', index: 0 })
  const link = readFileSync(join(wt.path, '.git'), 'utf8').trim()
  assert.ok(link.startsWith('gitdir: '), `expected a gitdir link, got ${link}`)
  const target = link.slice('gitdir: '.length)
  assert.equal(isAbsolute(target), false, `an absolute gitdir does not resolve inside a container: ${target}`)
})

test('createWorktree honors an explicit branch name', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run1', index: 2, branch: 'custom/branch' })
  assert.equal(wt.branch, 'custom/branch')
  assert.equal(await git(wt.path, ['rev-parse', '--abbrev-ref', 'HEAD']), 'custom/branch')
})

test('teardown of an untouched worktree removes it and deletes the branch', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run2', index: 0 })
  const res = await teardownWorktree({ gitRoot: repo, worktree: wt })
  assert.equal(res.changed, false)
  assert.ok(!existsSync(wt.path))
  const branches = await git(repo, ['branch', '--list', wt.branch])
  assert.equal(branches, '')
})

test('teardown preserves a worktree with uncommitted changes', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run3', index: 0 })
  writeFileSync(join(wt.path, 'new.txt'), 'dirty\n')
  const res = await teardownWorktree({ gitRoot: repo, worktree: wt })
  assert.equal(res.changed, true)
  assert.equal(res.preservedBranch, wt.branch)
  assert.equal(res.preservedPath, wt.path)
  assert.ok(existsSync(wt.path))
})

test('teardown preserves a worktree with a committed ahead commit', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run4', index: 0 })
  writeFileSync(join(wt.path, 'feature.txt'), 'work\n')
  await git(wt.path, ['add', '.'])
  await git(wt.path, ['commit', '-q', '-m', 'feature'])
  const res = await teardownWorktree({ gitRoot: repo, worktree: wt })
  assert.equal(res.changed, true)
  assert.equal(res.preservedBranch, wt.branch)
})

test('H10: committed work is preserved even after main HEAD advances (no false 0-ahead)', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run5', index: 0 })
  // agent commits work in the worktree
  writeFileSync(join(wt.path, 'feature.txt'), 'work\n')
  await git(wt.path, ['add', '.'])
  await git(wt.path, ['commit', '-q', '-m', 'feature'])
  // meanwhile main advances past the creation base
  writeFileSync(join(repo, 'b.txt'), 'main moved\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-q', '-m', 'main advance'])
  // teardown must still see the worktree as changed (compares against the CREATION base, not HEAD)
  const res = await teardownWorktree({ gitRoot: repo, worktree: wt })
  assert.equal(res.changed, true, 'committed work must not be force-deleted after main advances')
  assert.ok(existsSync(wt.path))
})

test('H10: teardown falls back to the recorded config base when base is not threaded', async () => {
  const created = await createWorktree({ gitRoot: repo, runId: 'run6', index: 0 })
  writeFileSync(join(created.path, 'feature.txt'), 'work\n')
  await git(created.path, ['add', '.'])
  await git(created.path, ['commit', '-q', '-m', 'feature'])
  // simulate primitives.ts reconstructing the Worktree WITHOUT base (the bug-prone path)
  const reconstructed: Worktree = { path: created.path, branch: created.branch }
  const res = await teardownWorktree({ gitRoot: repo, worktree: reconstructed })
  assert.equal(res.changed, true)
})

test('H10: a detection failure (bad base / missing worktree) preserves rather than deletes', async () => {
  const wt = await createWorktree({ gitRoot: repo, runId: 'run7', index: 0 })
  // Force the status/rev-list checks to fail by handing teardown a bogus base AND clearing config.
  await git(wt.path, ['config', '--unset', 'taskflow.base']).catch(() => {})
  const bogus: Worktree = { path: wt.path, branch: wt.branch, base: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }
  const res = await teardownWorktree({ gitRoot: repo, worktree: bogus })
  assert.equal(res.changed, true, 'an undetectable state must be treated as dirty')
  assert.ok(existsSync(wt.path))
})

test('H10: teardown never throws even on a totally bogus worktree', async () => {
  const res = await teardownWorktree({
    gitRoot: repo,
    worktree: { path: join(repo, 'does-not-exist'), branch: 'aw/ghost' },
  })
  assert.equal(typeof res.changed, 'boolean')
})

test('H9: createWorktree succeeds when a leftover worktree path from a crash exists (reuse/prune)', async () => {
  const first = await createWorktree({ gitRoot: repo, runId: 'resume1', index: 0 })
  writeFileSync(join(first.path, 'partial.txt'), 'half\n')
  // Simulate a crash: the worktree + branch are still registered and locked, never torn down.
  // A resume re-invokes createWorktree with the SAME deterministic name and must not error.
  const second = await createWorktree({ gitRoot: repo, runId: 'resume1', index: 0 })
  assert.ok(existsSync(second.path))
  assert.equal(second.path, first.path)
  assert.equal(second.branch, 'aw/resume1-0')
  // the new worktree is clean (fresh from base), so teardown removes it
  const res = await teardownWorktree({ gitRoot: repo, worktree: second })
  assert.equal(res.changed, false)
})

test('H9: createWorktree recovers when the on-disk dir was deleted but the registration lingers', async () => {
  const first = await createWorktree({ gitRoot: repo, runId: 'resume2', index: 1 })
  // crash leaves a stale registration; the dir itself is gone
  rmSync(first.path, { recursive: true, force: true })
  const second = await createWorktree({ gitRoot: repo, runId: 'resume2', index: 1 })
  assert.ok(existsSync(second.path))
  assert.equal(second.path, first.path)
})

test('worktrees live under .portta/worktrees and are isolated from each other', async () => {
  const a = await createWorktree({ gitRoot: repo, runId: 'iso', index: 0 })
  const b = await createWorktree({ gitRoot: repo, runId: 'iso', index: 1 })
  assert.notEqual(a.path, b.path)
  writeFileSync(join(a.path, 'only-a.txt'), 'a\n')
  assert.ok(existsSync(join(a.path, 'only-a.txt')))
  assert.ok(!existsSync(join(b.path, 'only-a.txt')))
  const dir = join(repo, '.portta', 'worktrees')
  const names = readdirSync(dir).sort()
  assert.deepEqual(names, ['iso-0', 'iso-1'])
})
