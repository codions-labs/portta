import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryKey } from 'portta-core'
import { describe, expect, it } from 'vitest'
import type { Database } from '../src/db/index.ts'
import type { LiveHub } from '../src/realtime/hub.ts'
import { createCommitWatch } from '../src/services/commit-watch.ts'
import { testConfig } from './helpers.ts'

const ROOT = '/srv/projects/product'
const KEY = repositoryKey(ROOT)

function writeScan(
  directory: string,
  head: string,
  subject: string,
  previous?: { sha: string; subject: string },
  date = 1_800_000_000,
) {
  writeFileSync(
    join(directory, 'index.json'),
    JSON.stringify({
      version: 1,
      collectedAt: 1_800_000_000,
      home: '/srv/projects',
      repositories: [
        { key: KEY, path: ROOT, name: 'product', remote: null, location: 'managed', relativePath: 'product' },
      ],
      environments: {},
    }),
  )
  writeFileSync(
    join(directory, `${KEY}.json`),
    JSON.stringify({
      version: 1,
      key: KEY,
      path: ROOT,
      name: 'product',
      collectedAt: 1_800_000_000,
      git: {
        branch: 'feature/session-owned-commits',
        detached: false,
        head: { sha: head, shortSha: head.slice(0, 7), subject, author: 'Ada', date },
        staged: 0,
        unstaged: 0,
        untracked: 0,
        unmerged: 0,
        dirty: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        remote: null,
      },
      reason: null,
      commits: [
        { sha: head, shortSha: head.slice(0, 7), subject, author: 'Ada', email: 'ada@example.test', date },
        ...(previous
          ? [
              {
                ...previous,
                shortSha: previous.sha.slice(0, 7),
                author: 'Ada',
                email: 'ada@example.test',
                date: 1_799_999_900,
              },
            ]
          : []),
      ],
      instructions: [],
      environments: [],
    }),
  )
}

describe('commit watch', () => {
  it('attributes a new HEAD to the active issue session without parsing its subject', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-commit-watch-'))
    const before = 'a'.repeat(40)
    const after = 'b'.repeat(40)
    writeScan(directory, before, 'Initial state')

    const recorded: Array<{
      sessionId: string
      head: string
      commits: Array<{ sha: string; subject: string; at: number }>
    }> = []
    const activity: Array<Record<string, unknown>> = []
    const session = {
      id: '7',
      projectId: '1',
      taskId: '42',
      repositoryId: '3',
      environmentId: null,
      actor: 'codex',
      actorKind: 'agent' as const,
      agent: 'codex',
      status: 'active' as const,
      startedAt: new Date(1_799_999_950_000),
      lastActivityAt: new Date(1_799_999_950_000),
      endedAt: null,
      summary: null,
      headBefore: before,
      headAfter: null,
      commits: [],
    }
    const db = {
      status: () => ({ available: true }),
      repositories: { list: async () => [{ id: '3', projectId: '1', name: 'product', localPath: ROOT }] },
      sessions: {
        list: async () => [session],
        recordCommits: async (sessionId: string, head: string, commits: (typeof recorded)[number]['commits']) => {
          recorded.push({ sessionId, head, commits })
        },
      },
      activity: {
        list: async () => [],
        append: async (entry: Record<string, unknown>) => {
          activity.push(entry)
          return { id: String(activity.length) }
        },
      },
    } as unknown as Database
    const hub = { publish: () => undefined } as unknown as LiveHub
    const watcher = createCommitWatch(testConfig({ gitDir: directory }), db, hub)

    await watcher.tick()
    writeScan(directory, after, 'Fix checkout race', { sha: before, subject: 'Initial state' })
    await watcher.tick()

    expect(recorded).toEqual([
      {
        sessionId: '7',
        head: after,
        commits: [{ sha: after, subject: 'Fix checkout race', at: 1_800_000_000 }],
      },
    ])
    expect(activity).toEqual([
      expect.objectContaining({
        kind: 'repository.commit',
        projectId: '1',
        repositoryId: '3',
        data: expect.objectContaining({ head: after, previous: before }),
      }),
    ])
  })

  it('does not attribute a commit already present at the active session boundary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-commit-watch-'))
    const before = 'a'.repeat(40)
    const after = 'b'.repeat(40)
    writeScan(directory, before, 'Initial state', undefined, 1_799_999_900)

    const recorded: string[] = []
    let sessions: object[] = []
    const db = {
      status: () => ({ available: true }),
      repositories: { list: async () => [{ id: '3', projectId: '1', name: 'product', localPath: ROOT }] },
      sessions: {
        list: async () => sessions,
        recordCommits: async (sessionId: string) => {
          recorded.push(sessionId)
        },
      },
      activity: {
        list: async () => [],
        append: async () => ({ id: '1' }),
      },
    } as unknown as Database
    const watcher = createCommitWatch(testConfig({ gitDir: directory }), db, {
      publish: () => undefined,
    } as unknown as LiveHub)

    await watcher.tick()
    writeScan(directory, after, 'Commit before session', { sha: before, subject: 'Initial state' }, 1_800_000_000)
    sessions = [
      {
        id: '8',
        projectId: '1',
        taskId: '43',
        repositoryId: '3',
        environmentId: null,
        actor: 'codex',
        actorKind: 'agent',
        agent: 'codex',
        status: 'active',
        startedAt: new Date(1_799_999_990_000),
        lastActivityAt: new Date(1_799_999_990_000),
        endedAt: null,
        summary: null,
        headBefore: after,
        headAfter: null,
        commits: [],
      },
    ]
    await watcher.tick()

    expect(recorded).toEqual([])
  })
})
