import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NodeWorkflowRunner, type WorkflowRunSpec } from '../services/workflow-runner.ts'

function spec(directory: string, source: string, engineRunId = 'engine_01'): WorkflowRunSpec {
  return {
    runId: 'run_01',
    engineRunId,
    spec: {
      cwd: directory,
      source,
      args: { issue: 'TASK-025' },
      dataRoot: join(directory, 'data'),
      externalContext: { owner: 'taskflow', projectId: 'project_01', runId: 'run_01', workspaceId: 'workspace_01' },
      fake: true,
    },
  }
}

describe('NodeWorkflowRunner', () => {
  it('completes a fake workflow in-process and advances the cursor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-direct-runner-'))
    try {
      const runner = new NodeWorkflowRunner()
      const handle = runner.run(
        spec(directory, "export const meta = { name: 'test', description: 'test' }\nreturn await agent('hello')"),
      )
      expect(runner.inspect('engine_01')?.active).toBe(true)
      await expect(handle.done).resolves.toEqual(
        expect.objectContaining({ type: 'completed', cursor: expect.any(Number) }),
      )
      expect(handle.cursor).toBeGreaterThan(0)
      expect(handle.pid).toBe(process.pid)
      expect(runner.inspect('engine_01')).toBeNull()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('emits started, events, heartbeat, and completed without IPC', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-direct-order-'))
    try {
      const types: string[] = []
      const handle = new NodeWorkflowRunner().run(
        spec(directory, "export const meta = { name: 'test', description: 'test' }\nreturn null"),
        {
          onMessage: (message): void => {
            types.push(message.type)
          },
        },
      )
      await expect(handle.done).resolves.toEqual(expect.objectContaining({ type: 'completed' }))
      expect(types[0]).toBe('started')
      expect(types).toContain('event')
      expect(types.at(-1)).toBe('completed')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('acknowledges cancel and isolates concurrent Runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-direct-cancel-'))
    try {
      const runner = new NodeWorkflowRunner()
      const hanging = spec(
        directory,
        "export const meta = { name: 'hang', description: 'hang' }\nawait new Promise(() => {})",
        'engine_hang',
      )
      hanging.runId = 'run_hang'
      hanging.spec.externalContext = { ...hanging.spec.externalContext, runId: 'run_hang' }
      const completing = spec(
        directory,
        "export const meta = { name: 'ok', description: 'ok' }\nreturn await agent('done')",
        'engine_ok',
      )
      completing.runId = 'run_ok'
      completing.spec.externalContext = { ...completing.spec.externalContext, runId: 'run_ok' }
      completing.spec.dataRoot = join(directory, 'data-ok')
      const hangHandle = runner.run(hanging)
      const okHandle = runner.run(completing)
      await hangHandle.cancel()
      await expect(hangHandle.done).resolves.toEqual(expect.objectContaining({ type: 'failed' }))
      expect(hangHandle.cancelAcknowledged).toBe(true)
      await expect(okHandle.done).resolves.toEqual(expect.objectContaining({ type: 'completed' }))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('resumes a completed fake workflow from the same engine journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-direct-resume-'))
    try {
      const runner = new NodeWorkflowRunner()
      const first = spec(
        directory,
        "export const meta = { name: 'test', description: 'test' }\nreturn await agent('hello')",
      )
      const firstHandle = runner.run(first)
      await expect(firstHandle.done).resolves.toEqual(expect.objectContaining({ type: 'completed' }))
      const resumed = spec(directory, first.spec.source)
      resumed.spec.resume = true
      const resumeHandle = runner.run(resumed)
      await expect(resumeHandle.done).resolves.toEqual(expect.objectContaining({ type: 'completed' }))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('surfaces a crash without taking down the host process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-direct-crash-'))
    try {
      const handle = new NodeWorkflowRunner().run(
        spec(directory, "export const meta = { name: 'broken' }\nreturn null"),
      )
      await expect(handle.done).resolves.toEqual(expect.objectContaining({ type: 'crash' }))
      expect(process.exitCode ?? 0).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
