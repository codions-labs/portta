import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DefaultWorkerFactory, runWorkflow } from '../../../../src/modules/taskflow/workflows/index.ts'

function writeWorkflow(root: string, body: string): string {
  const path = join(root, 'workflow.js')
  writeFileSync(path, `export const meta = { name: "taskflow-embed", description: "embed" }\n${body}\n`)
  return path
}

test('host-owned signals abort one Run without registering process listeners', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-embed-signal-'))
  try {
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'await new Promise(() => {})')
    const abort = new AbortController()
    const before = process.listenerCount('SIGINT')
    const pending = runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: join(root, 'data'), workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'p', runId: 'run_hang', workspaceId: 'w' },
      signal: abort.signal,
    })
    assert.equal(process.listenerCount('SIGINT'), before)
    abort.abort()
    const outcome = await pending
    assert.equal(outcome.status, 'interrupted')
    assert.equal(process.listenerCount('SIGINT'), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent Runs keep isolated factories and abort independently', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-embed-concurrent-'))
  try {
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    mkdirSync(join(root, 'hang'), { recursive: true })
    mkdirSync(join(root, 'ok'), { recursive: true })
    const hang = writeWorkflow(join(root, 'hang'), 'await new Promise(() => {})')
    const ok = writeWorkflow(join(root, 'ok'), 'return await agent("done")')
    const abort = new AbortController()
    const hanging = runWorkflow({
      file: hang,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: join(root, 'data-hang'), workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'p', runId: 'run_hang', workspaceId: 'w' },
      signal: abort.signal,
      factory: new DefaultWorkerFactory({ fake: true }),
    })
    const completing = runWorkflow({
      file: ok,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: join(root, 'data-ok'), workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'p', runId: 'run_ok', workspaceId: 'w' },
      factory: new DefaultWorkerFactory({ fake: true }),
    })
    abort.abort()
    const [hangOutcome, okOutcome] = await Promise.all([hanging, completing])
    assert.equal(hangOutcome.status, 'interrupted')
    assert.equal(okOutcome.status, 'completed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
