import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  type ExecutionPort,
  type ExecutionWorkspace,
  runWorkflow,
} from '../../../../src/modules/taskflow/workflows/index.ts'

function writeWorkflow(root: string, body: string): string {
  const path = join(root, 'workflow.js')
  writeFileSync(path, `export const meta = { name: "fan-out", description: "write fan-out" }\n${body}\n`)
  return path
}

function fakePort(): ExecutionPort & { acquired: ExecutionWorkspace[]; released: string[] } {
  const acquired: ExecutionWorkspace[] = []
  const released: string[] = []
  return {
    acquired,
    released,
    async acquireWorkspace(request) {
      const workspace: ExecutionWorkspace = {
        leaseId: `lease_${request.branchSlug ?? request.executionKey}`,
        cwd: `/leases/${request.branchSlug ?? 'fork'}`,
        branch: `taskflow/${request.branchSlug ?? 'fork'}`,
        baseCommit: 'abc123',
      }
      acquired.push(workspace)
      return workspace
    },
    async releaseWorkspace(leaseId) {
      released.push(leaseId)
    },
    async summarizeWorkspace(leaseId) {
      return { leaseId, branch: 'taskflow/fork', baseCommit: 'abc123', head: 'abc123', dirty: true }
    },
  }
}

test('parallel write fan-out receives exclusive leased cwds and releases them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-fanout-'))
  try {
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(
      root,
      `
const built = await parallel([
  () => agent("implement A", { worktree: "bake-off/a", key: "impl-a" }),
  () => agent("implement B", { worktree: "bake-off/b", key: "impl-b" }),
])
return { winners: built.filter(Boolean).length }
`,
    )
    const port = fakePort()
    const outcome = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: join(root, 'data'), workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'p', runId: 'run_fanout', workspaceId: 'w' },
      executionPort: port,
    })
    assert.equal(outcome.status, 'completed')
    assert.equal(port.acquired.length, 2)
    assert.notEqual(port.acquired[0]?.cwd, port.acquired[1]?.cwd)
    assert.deepEqual(
      port.acquired.map((item) => item.baseCommit),
      ['abc123', 'abc123'],
    )
    assert.equal(port.released.length, 2)
    assert.equal(JSON.parse(JSON.stringify(outcome.result)).winners, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cancelling a fan-out still releases the leased workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-fanout-cancel-'))
  try {
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'await new Promise(() => {})')
    const port = fakePort()
    const abort = new AbortController()
    const pending = runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: join(root, 'data'), workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'p', runId: 'run_cancel', workspaceId: 'w' },
      executionPort: port,
      signal: abort.signal,
    })
    abort.abort()
    const outcome = await pending
    assert.equal(outcome.status, 'interrupted')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
