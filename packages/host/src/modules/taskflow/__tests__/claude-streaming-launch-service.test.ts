import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProfileConfig, WorktreeMeta } from 'portta-core/taskflow'
import { afterEach, describe, expect, it } from 'vitest'
import { buildClaudeStreamingLaunchContext } from '../services/claude-streaming-launch-service.ts'

const tempDirs: string[] = []

function makeMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    schemaVersion: 1,
    worktreeId: 'wt_claude',
    branch: 'feature/claude-stream',
    createdAt: '2026-05-28T10:00:00.000Z',
    profile: 'default',
    agent: 'claude',
    runtime: 'host',
    startupEnvValues: {
      STARTUP_TOKEN: 'startup-token',
    },
    allocatedPorts: {
      FRONTEND_PORT: 3010,
    },
    ...overrides,
  }
}

function makeProfile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    runtime: 'host',
    envPassthrough: [],
    panes: [],
    ...overrides,
  }
}

describe('buildClaudeStreamingLaunchContext', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('matches the managed terminal runtime env for host Claude streams', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-claude-stream-'))
    tempDirs.push(worktreePath)
    await nodeTest.write(join(worktreePath, '.env.local'), 'DOTENV_ONLY=local-value\n')

    const context = await buildClaudeStreamingLaunchContext({
      meta: makeMeta(),
      profile: makeProfile({
        yolo: true,
        systemPrompt: 'Ship carefully',
      }),
      worktreePath,
    })

    expect(context).toEqual({
      env: {
        DOTENV_ONLY: 'local-value',
        STARTUP_TOKEN: 'startup-token',
        FRONTEND_PORT: '3010',
        PORTTA_FLOW_WORKTREE_PATH: worktreePath,
        PORTTA_FLOW_WORKTREE_ID: 'wt_claude',
        PORTTA_FLOW_BRANCH: 'feature/claude-stream',
        PORTTA_FLOW_PROFILE: 'default',
        PORTTA_FLOW_AGENT: 'claude',
        PORTTA_FLOW_RUNTIME: 'host',
      },
      permissionMode: 'bypassPermissions',
      systemPrompt: 'Ship carefully',
    })
  })

  it('does not build a streaming launch context for non-host runtimes', async () => {
    const context = await buildClaudeStreamingLaunchContext({
      meta: makeMeta({ runtime: 'docker' }),
      profile: makeProfile({ runtime: 'docker', image: 'node:22' }),
      worktreePath: '/repo/__worktrees/feature/claude-stream',
    })

    expect(context).toBeNull()
  })
})
