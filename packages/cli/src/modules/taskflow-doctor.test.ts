import { describe, expect, it } from 'vitest'
import type { InitDependency } from '../commands/flow/init-deps.ts'
import { daemonCheck, type TaskflowDoctorProbes, taskflowDoctorChecks } from './taskflow-doctor.js'

const origin = 'http://127.0.0.1:5111'

describe('the Taskflow daemon check', () => {
  it('tells a daemon that is down from one refusing the token or too old to serve the module', () => {
    expect(daemonCheck(origin, 't', { reached: false })).toMatchObject({
      status: 'warn',
      fix: expect.stringContaining('portta host serve'),
    })
    expect(daemonCheck(origin, null, { reached: true, health: true, module: null }).status).toBe('warn')
    expect(daemonCheck(origin, 't', { reached: true, health: true, module: 401 }).status).toBe('fail')
    expect(daemonCheck(origin, 't', { reached: true, health: true, module: 404 })).toMatchObject({
      status: 'warn',
      fix: expect.stringContaining('update portta on the host'),
    })
    expect(daemonCheck(origin, 't', { reached: true, health: true, module: 200 }).status).toBe('pass')
  })
})

describe('the Taskflow tool checks', () => {
  const probes = (found: string[]): TaskflowDoctorProbes => ({
    daemon: async () => ({ reached: true, health: true, module: 200 }),
    tool: (dependency: InitDependency) => ({ ...dependency, found: found.includes(dependency.tool), probeOk: true }),
    devcontainerCli: () => null,
  })
  const statusOf = (checks: Awaited<ReturnType<typeof taskflowDoctorChecks>>, id: string) =>
    checks.find((entry) => entry.id === id)?.status

  it('fails a missing required tool and only informs about an optional one', async () => {
    const checks = await taskflowDoctorChecks({ env: {}, root: '/nonexistent' }, probes(['node', 'python3', 'tmux']))
    expect(statusOf(checks, 'taskflow-tool-git')).toBe('fail')
    expect(statusOf(checks, 'taskflow-tool-gh')).toBe('info')
    expect(statusOf(checks, 'taskflow-tool-devcontainer')).toBe('info')
  })

  it('accepts herdr in place of tmux', async () => {
    expect(
      statusOf(await taskflowDoctorChecks({ env: {}, root: '/nonexistent' }, probes(['git'])), 'taskflow-tool-tmux'),
    ).toBe('fail')
    const withHerdr = await taskflowDoctorChecks({ env: {}, root: '/nonexistent' }, probes(['git', 'herdr']))
    expect(statusOf(withHerdr, 'taskflow-tool-tmux')).toBe('info')
    expect(statusOf(withHerdr, 'taskflow-tool-herdr')).toBe('pass')
  })
})
