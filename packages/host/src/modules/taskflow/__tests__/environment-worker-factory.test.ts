import { describe, expect, it } from 'vitest'
import { mapAgentSpecToEnvironment } from '../services/environment-worker-factory.ts'

describe('mapAgentSpecToEnvironment', () => {
  it('keeps a host launcher cwd while giving the agent its container cwd', () => {
    const mapped = mapAgentSpecToEnvironment(
      {
        prompt: 'fix it',
        provider: 'codex',
        cwd: '/repo/worktree/packages/api',
        sandbox: 'workspace-write',
        approval: 'never',
      },
      '/repo/worktree',
      '/workspaces/project',
    )
    expect(mapped).toMatchObject({
      cwd: '/workspaces/project/packages/api',
      launcherCwd: '/repo/worktree/packages/api',
      launcherEnv: { PORTTA_FLOW_ENVIRONMENT_CWD: '/workspaces/project/packages/api' },
    })
  })

  it('rejects a cwd outside the mounted workspace', () => {
    expect(() =>
      mapAgentSpecToEnvironment(
        {
          prompt: 'fix it',
          provider: 'codex',
          cwd: '/repo/other',
          sandbox: 'workspace-write',
          approval: 'never',
        },
        '/repo/worktree',
        '/workspaces/project',
      ),
    ).toThrow('outside the environment mount')
  })
})
