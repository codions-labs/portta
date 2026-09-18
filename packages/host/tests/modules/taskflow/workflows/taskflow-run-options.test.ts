import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  Journal,
  listWorkflows,
  runWorkflow,
  type WorkflowEvent,
} from '../../../../src/modules/taskflow/workflows/index.ts'

type AgentEvent = Extract<WorkflowEvent, { type: 'agent' }>

function writeWorkflow(root: string, body: string): string {
  const path = join(root, 'workflow.js')
  writeFileSync(path, `export const meta = { name: "taskflow-test", description: "Taskflow test" }\n${body}\n`)
  return path
}

function agentEvents(events: WorkflowEvent[]): AgentEvent[] {
  return events.filter((event): event is AgentEvent => event.type === 'agent')
}

test('Taskflow persists external context only when creating a journal and restores it on resume', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-context-'))
  try {
    const dataRoot = join(root, 'data')
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'return await agent("one")')
    const original = { owner: 'taskflow', projectId: 'project_01', runId: 'run_01', workspaceId: 'workspace_01' }

    const first = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      externalContext: original,
    })
    assert.equal(first.status, 'completed')
    assert.deepEqual(Journal.load('run_01', { dataRoot }).meta?.externalContext, original)

    const resumed = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      resumeRunId: 'run_01',
      externalContext: { ...original, owner: 'replacement' },
    })
    assert.equal(resumed.status, 'completed')
    assert.deepEqual(Journal.load('run_01', { dataRoot }).meta?.externalContext, original)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Taskflow roots isolate journals with the same Run id', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-roots-'))
  try {
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'return "done"')
    const rootA = join(root, 'data-a')
    const rootB = join(root, 'data-b')

    await runWorkflow({
      file,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: rootA, workspaceRoot },
      externalContext: { owner: 'a', projectId: 'project-a', runId: 'same-run', workspaceId: 'workspace-a' },
    })
    await runWorkflow({
      file,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot: rootB, workspaceRoot },
      externalContext: { owner: 'b', projectId: 'project-b', runId: 'same-run', workspaceId: 'workspace-b' },
    })

    assert.equal(Journal.load('same-run', { dataRoot: rootA }).meta?.externalContext?.owner, 'a')
    assert.equal(Journal.load('same-run', { dataRoot: rootB }).meta?.externalContext?.owner, 'b')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Taskflow agent events retain deterministic keys and indices through parallel replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-events-'))
  try {
    const dataRoot = join(root, 'data')
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'return await parallel([() => agent("alpha"), () => agent("beta")])')
    const context = { owner: 'taskflow', projectId: 'project_01', runId: 'run_01', workspaceId: 'workspace_01' }
    const firstEvents: WorkflowEvent[] = []
    const first = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      externalContext: context,
      onEvent: (event): void => {
        firstEvents.push(event)
      },
    })
    assert.equal(first.status, 'completed')
    const firstAgents = agentEvents(firstEvents).filter((event) => event.state === 'queued')
    assert.equal(firstAgents.length, 2)
    assert.ok(firstAgents.every((event) => typeof event.key === 'string' && event.key.length > 0))

    const resumedEvents: WorkflowEvent[] = []
    const resumed = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      resumeRunId: 'run_01',
      onEvent: (event): void => {
        resumedEvents.push(event)
      },
    })
    assert.equal(resumed.status, 'completed')
    const replayed = agentEvents(resumedEvents).filter((event) => event.state === 'done' && event.cached)
    assert.deepEqual(
      replayed.map((event) => ({ key: event.key, index: event.index })).sort((a, b) => a.index - b.index),
      firstAgents.map((event) => ({ key: event.key, index: event.index })).sort((a, b) => a.index - b.index),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Taskflow sequential and pipeline fixtures resume without rerunning completed nodes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-mvp-'))
  try {
    const dataRoot = join(root, 'data')
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const context = { owner: 'taskflow', projectId: 'project_01', runId: 'run_mvp_01', workspaceId: 'workspace_01' }
    const file = writeWorkflow(
      root,
      `
      const inspected = await agent("inspect")
      return await pipeline(["a", "b"], (item) => agent("apply:" + item + ":" + inspected))
    `,
    )
    const firstEvents: WorkflowEvent[] = []
    const first = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      externalContext: context,
      onEvent: (event): void => {
        firstEvents.push(event)
      },
    })
    assert.equal(first.status, 'completed')
    assert.equal(agentEvents(firstEvents).filter((event) => event.state === 'done').length, 3)

    const resumedEvents: WorkflowEvent[] = []
    const resumed = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      resumeRunId: context.runId,
      onEvent: (event): void => {
        resumedEvents.push(event)
      },
    })
    assert.equal(resumed.status, 'completed')
    assert.equal(agentEvents(resumedEvents).filter((event) => event.state === 'done' && event.cached).length, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Taskflow routes worktree isolation through an injected ExecutionPort', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-lease-'))
  try {
    const dataRoot = join(root, 'data')
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'return await agent("write", { worktree: "bake-off/a" })')
    const acquired: string[] = []
    const released: string[] = []
    const outcome = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'project_01', runId: 'run_lease', workspaceId: 'workspace_01' },
      executionPort: {
        async acquireWorkspace(request) {
          acquired.push(request.branchSlug ?? '')
          return { leaseId: 'lease_a', cwd: workspaceRoot, branch: 'taskflow/fork-a', baseCommit: 'abc123' }
        },
        async releaseWorkspace(leaseId) {
          released.push(leaseId)
        },
        async summarizeWorkspace() {
          return { leaseId: 'lease_a', branch: 'taskflow/fork-a', baseCommit: 'abc123', head: 'abc123', dirty: false }
        },
      },
    })
    assert.equal(outcome.status, 'completed')
    assert.deepEqual(acquired, ['bake-off/a'])
    assert.deepEqual(released, ['lease_a'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Taskflow rejects engine worktree DSL before creating a journaled agent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-worktree-'))
  try {
    const dataRoot = join(root, 'data')
    const workspaceRoot = join(root, 'workspace')
    mkdirSync(workspaceRoot, { recursive: true })
    const file = writeWorkflow(root, 'return await agent("write", { worktree: true })')

    const outcome = await runWorkflow({
      file,
      fake: true,
      quiet: true,
      mode: 'taskflow',
      roots: { dataRoot, workspaceRoot },
      externalContext: { owner: 'taskflow', projectId: 'project_01', runId: 'run_01', workspaceId: 'workspace_01' },
    })

    assert.equal(outcome.status, 'failed')
    assert.match(outcome.error ?? '', /Taskflow owns workspace lifecycle/)
    assert.equal(Journal.load('run_01', { dataRoot }).results.size, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('registry accepts explicit roots without inspecting the daemon cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-engine-registry-'))
  try {
    const projectRoot = join(root, 'project-workflows')
    mkdirSync(projectRoot, { recursive: true })
    const workflow = writeWorkflow(projectRoot, 'return "registry"')

    const entries = listWorkflows('/not/the/project', {
      projectDirs: [projectRoot],
      globalDir: join(root, 'empty-global'),
      builtinDir: join(root, 'empty-builtin'),
    })

    assert.deepEqual(
      entries.map((entry) => entry.filePath),
      [workflow],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
