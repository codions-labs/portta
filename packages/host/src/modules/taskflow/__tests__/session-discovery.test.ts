import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureNewSessionId,
  readCodexSessionCwdId,
  readProviderSessionActivity,
  type SessionDiscoveryGateway,
} from '../adapters/session-discovery.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Returns a fresh list of ids on each call, simulating a session file appearing late. */
function scriptedDiscovery(sequence: string[][]): SessionDiscoveryGateway {
  let call = 0
  return {
    async listSessionIds(): Promise<string[]> {
      const result = sequence[Math.min(call, sequence.length - 1)] ?? []
      call += 1
      return result
    },
  }
}

const noSleep = async (): Promise<void> => {}

describe('captureNewSessionId', () => {
  it('returns the id that appears after the spawn', async () => {
    const discovery = scriptedDiscovery([['new-1', 'old-1']])
    const id = await captureNewSessionId(discovery, 'claude', '/cwd', ['old-1'], { sleep: noSleep })
    expect(id).toBe('new-1')
  })

  it('polls until the new session file shows up', async () => {
    // First two polls see only the pre-existing session, third sees the fork.
    const discovery = scriptedDiscovery([['old-1'], ['old-1'], ['fork-2', 'old-1']])
    const id = await captureNewSessionId(discovery, 'codex', '/cwd', ['old-1'], { sleep: noSleep, attempts: 5 })
    expect(id).toBe('fork-2')
  })

  it('returns the newest of multiple new ids (listing is newest-first)', async () => {
    const discovery = scriptedDiscovery([['newest', 'older-new', 'old-1']])
    const id = await captureNewSessionId(discovery, 'claude', '/cwd', ['old-1'], { sleep: noSleep })
    expect(id).toBe('newest')
  })

  it('returns null when nothing new appears within the retry budget', async () => {
    const discovery = scriptedDiscovery([['old-1']])
    const id = await captureNewSessionId(discovery, 'claude', '/cwd', ['old-1'], { sleep: noSleep, attempts: 3 })
    expect(id).toBeNull()
  })
})

describe('readCodexSessionCwdId', () => {
  it('reads session metadata when the first rollout line exceeds 16 KiB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-codex-session-'))
    tempDirs.push(dir)
    const path = join(dir, 'rollout.jsonl')
    const metadata = {
      type: 'session_meta',
      payload: {
        id: 'session-long',
        cwd: '/repo/worktree',
        developer_instructions: 'x'.repeat(20_000),
      },
    }
    await writeFile(path, `${JSON.stringify(metadata)}\n{"type":"event_msg"}\n`)

    await expect(readCodexSessionCwdId(path)).resolves.toEqual({
      id: 'session-long',
      cwd: '/repo/worktree',
    })
  })
})

describe('readProviderSessionActivity', () => {
  it('reports a completed Codex turn as waiting for input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-codex-activity-'))
    tempDirs.push(dir)
    const path = join(dir, 'rollout.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
        '',
      ].join('\n'),
    )

    await expect(readProviderSessionActivity('codex', path)).resolves.toBe('waiting_input')
  })

  it('reports an unfinished Claude turn as running', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-claude-activity-'))
    tempDirs.push(dir)
    const path = join(dir, 'session.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'start' } }),
        JSON.stringify({
          type: 'assistant',
          isSidechain: false,
          message: { role: 'assistant', content: 'é'.repeat(40_000), stop_reason: 'tool_use' },
        }),
        JSON.stringify({ type: 'progress' }),
        '',
      ].join('\n'),
    )

    await expect(readProviderSessionActivity('claude', path)).resolves.toBe('running')
  })
})
