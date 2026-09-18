import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionRecord, RunRecord } from 'portta-core/taskflow'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunStore } from '../adapters/run-store.ts'
import { ExecutionTranscriptService } from '../services/execution-transcript-service.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function records(path: string): { run: RunRecord; execution: ExecutionRecord } {
  return {
    run: {
      id: 'run_01',
      projectId: 'project',
      mode: 'workflow',
      input: 'Review',
      status: 'running',
      workspacePolicy: 'run',
      workflowSnapshotId: 'snapshot',
      environmentId: null,
      workspaceId: 'workspace',
      worktreePath: '/work',
      canonicalWorkspacePath: '/work',
      branch: 'review',
      baseBranch: 'main',
      baseCommit: 'abc',
      profile: null,
      engineKind: 'workflow-engine',
      engineRunId: 'engine_01',
      error: null,
      result: null,
      operationId: 'op',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      startedAt: new Date(0).toISOString(),
      completedAt: null,
      issueRef: null,
    },
    execution: {
      id: 'execution_01',
      runId: 'run_01',
      nodeKey: 'workflow:0',
      label: 'Security',
      phase: 'Review',
      attempt: 1,
      harness: 'codex',
      provider: 'openai',
      model: 'gpt-5',
      effectiveConfig: { transcriptPath: path },
      workspaceId: 'workspace',
      input: 'Review',
      output: null,
      status: 'running',
      usage: null,
      error: null,
      sessionId: null,
      capabilities: null,
      checkpoint: null,
      startedAt: new Date(0).toISOString(),
      completedAt: null,
    },
  }
}

describe('ExecutionTranscriptService', () => {
  it('reads complete JSONL chunks with stable byte cursors and ignores an incomplete tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taskflow-transcript-'))
    roots.push(root)
    const path = join(root, 'runs', 'engine_01', 'agents', '0.jsonl')
    await mkdir(join(root, 'runs', 'engine_01', 'agents'), { recursive: true })
    const first = `${JSON.stringify({ t: 1, kind: 'meta', index: 0, label: 'Security', provider: 'openai', prompt: 'Review' })}\n`
    const second = `${JSON.stringify({ t: 2, kind: 'text', text: 'Found issue' })}\n`
    await writeFile(path, `${first}${second}{"t":3,"kind":"text"`)
    const { run, execution } = records(path)
    const store = { getExecution: () => execution, getRun: () => run } as unknown as RunStore
    const service = new ExecutionTranscriptService(store)

    const initial = await service.read(execution.id)
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(initial.response.entries.map((entry) => entry.chunk.kind)).toEqual(['meta', 'text'])
    expect(initial.response.nextCursor).toBe(Buffer.byteLength(first + second))

    const replay = await service.read(execution.id, Buffer.byteLength(first))
    expect(replay.ok && replay.response.entries.map((entry) => entry.chunk.kind)).toEqual(['text'])
  })

  it("rejects transcript paths that are not scoped to the execution's engine run", async () => {
    const { run, execution } = records('/tmp/runs/another-run/agents/0.jsonl')
    const store = { getExecution: () => execution, getRun: () => run } as unknown as RunStore
    expect(await new ExecutionTranscriptService(store).read(execution.id)).toEqual({
      ok: false,
      reason: 'unavailable',
    })
  })

  it('reads a Direct Run transcript from its provider session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taskflow-direct-transcript-'))
    roots.push(root)
    const path = join(root, 'rollout.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({ type: 'session_meta', payload: { id: 'session-01', cwd: '/work' } }),
        JSON.stringify({
          timestamp: '2026-09-09T12:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-01' },
        }),
        JSON.stringify({
          timestamp: '2026-09-09T12:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', phase: 'analysis', message: 'Checking the code' },
        }),
        JSON.stringify({
          timestamp: '2026-09-09T12:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Fixed the issue' },
        }),
        '',
      ].join('\n'),
    )
    const { run, execution } = records(path)
    const directRun: RunRecord = {
      ...run,
      mode: 'direct',
      workflowSnapshotId: null,
      engineKind: null,
      engineRunId: null,
    }
    const directExecution: ExecutionRecord = {
      ...execution,
      nodeKey: 'direct:root',
      label: 'Direct session',
      effectiveConfig: { profile: 'default', transcriptSource: 'provider_session' },
      sessionId: 'session-01',
    }
    const store = {
      getExecution: () => directExecution,
      getRun: () => directRun,
    } as unknown as RunStore
    const service = new ExecutionTranscriptService(store, {
      listSessionIds: async () => ['session-01'],
      findSessionPath: async () => path,
    })

    const transcript = await service.read(directExecution.id)
    expect(transcript.ok).toBe(true)
    if (!transcript.ok) return
    expect(transcript.response.entries.map((entry) => entry.chunk.kind)).toEqual(['meta', 'reasoning', 'text'])
    expect(transcript.response.entries.at(-1)?.chunk).toEqual({
      t: Date.parse('2026-09-09T12:00:03.000Z'),
      kind: 'text',
      text: 'Fixed the issue',
    })
    expect((await service.read(directExecution.id, 2)).ok).toBe(true)
    expect((await service.read(directExecution.id, 2)) as unknown).toMatchObject({
      response: { entries: [{ cursor: 3 }] },
    })
    expect((await service.read(directExecution.id, 99)) as unknown).toMatchObject({
      response: { entries: [{ cursor: 1 }, { cursor: 2 }, { cursor: 3 }], nextCursor: 3 },
    })
  })
})
