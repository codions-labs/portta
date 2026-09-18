import { describe, expect, test } from 'vitest'
import { gitRuntimePaths, globalPaths, projectPaths } from './paths.ts'

describe('host paths', () => {
  test('resolves global paths beneath ~/.portta/state/host', () => {
    expect(globalPaths({ home: '/home/alice', env: {} })).toEqual({
      root: '/home/alice/.portta/state/host',
      env: '/home/alice/.portta/.env',
      controlToken: '/home/alice/.portta/state/host/token',
      projectsRegistry: '/home/alice/.portta/state/host/projects.json',
      database: '/home/alice/.portta/state/host/taskflow.db',
      runs: '/home/alice/.portta/state/host/runs',
      workflows: '/home/alice/.portta/state/host/workflows',
    })
  })

  test('honors PORTTA_HOME', () => {
    expect(globalPaths({ home: '/ignored', env: { PORTTA_HOME: '/data/portta' } }).root).toBe('/data/portta/state/host')
  })

  test('honors PORTTA_HOST_STATE_DIR for the state directory alone', () => {
    const paths = globalPaths({ home: '/home/alice', env: { PORTTA_HOST_STATE_DIR: '/tmp/state' } })
    expect(paths.root).toBe('/tmp/state')
    expect(paths.env).toBe('/home/alice/.portta/.env')
  })

  test('resolves project and git runtime paths', () => {
    expect(projectPaths('/repo').config).toBe('/repo/.portta/taskflow.yaml')
    expect(projectPaths('/repo').localConfig).toBe('/repo/.portta/taskflow.local.yaml')
    expect(gitRuntimePaths('/repo/.git/worktrees/feature').runtimeEnv).toBe(
      '/repo/.git/worktrees/feature/portta/runtime.env',
    )
  })
})
