import type { Environment, EnvironmentService } from 'portta-contracts/taskflow'
import { describe, expect, it, vi } from 'vitest'
import { parseFlowAction } from './test-support.ts'
import {
  type EnvironmentCommandApi,
  type EnvironmentCommandDependencies,
  environmentBaseUrlFromControlUrl,
  environmentFromCli,
  runEnvironmentCommand,
} from './worktree-commands.ts'

const environment: Environment = {
  id: 'env_abc',
  provider: 'host',
  status: 'ready',
  desiredStatus: 'ready',
  scope: { installationId: 'install', projectId: 'project', workspaceId: 'workspace' },
  workspace: { hostPath: '/repo' },
  configRef: null,
  configHash: 'host',
  capabilities: {
    exec: true,
    stdin: true,
    pty: false,
    resize: false,
    signals: true,
    reattach: false,
    services: true,
    rebuild: false,
  },
  security: {
    trusted: true,
    reasons: [],
    initializeCommand: false,
    privileged: false,
    dockerSocket: false,
    devices: false,
    broadMounts: false,
    features: [],
    unpinnedFeatures: [],
    addedCapabilities: [],
    securityOptions: [],
    secretKeys: [],
    isolationRisks: [],
  },
  error: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

const service: EnvironmentService = {
  id: 'service_api',
  environmentId: environment.id,
  name: 'api',
  status: 'running',
  kind: 'http',
  containerIds: [],
  ports: [{ containerPort: 8080, protocol: 'http' }],
  endpoints: [
    {
      id: 'endpoint_api',
      serviceId: 'service_api',
      url: 'http://api-abc.localhost:5111',
      audiences: ['user'],
      visibility: 'private',
      accessMode: 'localhost',
      executionLocus: 'host',
      stable: true,
    },
  ],
  provenance: [{ source: 'taskflow', detail: 'test', confidence: 'explicit' }],
  actions: ['start', 'stop', 'restart'],
}

function fakeApi(): EnvironmentCommandApi {
  return {
    fetchRun: async () => ({ run: { environmentId: environment.id } }),
    fetchWorktrees: async () => ({ worktrees: [{ branch: 'feature/api', environmentId: environment.id }] }),
    fetchEnvironmentServices: async () => ({ services: [service] }),
    execEnvironment: async () => ({ stdout: '', stderr: '', code: 0, signal: null, timedOut: false }),
    openEnvironmentTerminal: async () => ({ command: '/bin/sh', args: [], cwd: '/repo' }),
    fetchEnvironmentLogs: async () => ({ command: '/bin/sh', args: ['-c', 'true'], cwd: '/repo' }),
    trustEnvironment: async () => ({ environment }),
    startEnvironment: async () => ({ environment }),
    stopEnvironment: async () => ({ environment: { ...environment, status: 'stopped', desiredStatus: 'stopped' } }),
    rebuildEnvironment: async () => ({ environment }),
    removeEnvironment: async () => ({ ok: true }),
    fetchEnvironment: async () => ({ environment }),
    exposeEnvironmentService: async () => ({ services: [service] }),
    controlEnvironmentService: async () => ({ services: [service] }),
    removeEndpoint: async () => ({ ok: true }),
  }
}

function dependencies(api: EnvironmentCommandApi): EnvironmentCommandDependencies {
  return { resolveBaseUrl: async () => 'http://localhost/project', createClient: () => api }
}

async function environmentRequest(args: string[]) {
  return environmentFromCli(await parseFlowAction(['environment', ...args]))
}

describe('environmentFromCli', () => {
  it('targets a worktree, defaulting to status', async () => {
    expect(await environmentRequest(['feature/api'])).toEqual({
      target: 'feature/api',
      byRun: false,
      action: 'status',
      operands: [],
      wait: false,
      copy: false,
    })
  })

  it('targets a Run and keeps exec arguments intact after --', async () => {
    expect(await environmentRequest(['--run', 'run_01', 'exec', '--', 'npm', 'test', '--watch'])).toMatchObject({
      target: 'run_01',
      byRun: true,
      action: 'exec',
      operands: ['npm', 'test', '--watch'],
    })
  })

  it('reads --wait and --copy', async () => {
    expect(await environmentRequest(['feature/api', 'open', 'web', '--copy'])).toMatchObject({
      action: 'open',
      operands: ['web'],
      copy: true,
    })
    expect(await environmentRequest(['feature/api', 'logs', '--wait'])).toMatchObject({ action: 'logs', wait: true })
  })

  it('is reachable through the env alias', async () => {
    expect(environmentFromCli(await parseFlowAction(['env', 'feature/api', 'stop']))).toMatchObject({ action: 'stop' })
  })

  it('rejects unknown actions and a missing target', async () => {
    await expect(environmentRequest(['feature/api', 'explode'])).rejects.toThrow('Unknown environment action: explode')
    await expect(environmentRequest([])).rejects.toThrow('requires a <branch> or --run <run-id>')
  })
})

describe('runEnvironmentCommand', () => {
  it('uses the session control URL as the authoritative project server', () => {
    expect(environmentBaseUrlFromControlUrl('http://127.0.0.1:5211/portta-demo-compose/api/runtime/events')).toBe(
      'http://127.0.0.1:5211/portta-demo-compose',
    )
    expect(environmentBaseUrlFromControlUrl('http://127.0.0.1:5211/api/worktrees')).toBeNull()
    expect(environmentBaseUrlFromControlUrl(undefined)).toBeNull()
  })

  it('shows the same structured service endpoint exposed by the API', async () => {
    const output: string[] = []
    const result = await runEnvironmentCommand(
      await environmentRequest(['feature/api', 'services']),
      5111,
      '/repo',
      (line) => output.push(line),
      vi.fn(),
      dependencies(fakeApi()),
    )

    expect(result).toBe(0)
    expect(output).toEqual(['api\trunning\thttp://api-abc.localhost:5111'])
  })

  it('routes lifecycle actions to the environment associated with a Run', async () => {
    const api = fakeApi()
    const stop = vi.fn(api.stopEnvironment)
    api.stopEnvironment = stop
    const output: string[] = []

    const result = await runEnvironmentCommand(
      await environmentRequest(['--run', 'run_01', 'stop']),
      5111,
      '/repo',
      (line) => output.push(line),
      vi.fn(),
      dependencies(api),
    )

    expect(result).toBe(0)
    expect(stop).toHaveBeenCalledWith({ params: { environmentId: environment.id } })
    expect(output).toEqual(['env_abc\thost\tstopped'])
  })

  it('routes a supported service action through the environment API', async () => {
    const api = fakeApi()
    const control = vi.fn(api.controlEnvironmentService)
    api.controlEnvironmentService = control
    const output: string[] = []

    const result = await runEnvironmentCommand(
      await environmentRequest(['feature/api', 'service', 'api', 'restart']),
      5111,
      '/repo',
      (line) => output.push(line),
      vi.fn(),
      dependencies(api),
    )

    expect(result).toBe(0)
    expect(control).toHaveBeenCalledWith({
      params: { environmentId: environment.id, serviceId: service.id },
      body: { action: 'restart' },
    })
    expect(output).toEqual(['api\trunning'])
  })

  it('renders a useful runtime monitor message instead of failing while trust is pending', async () => {
    const api = fakeApi()
    const start = vi.fn(api.startEnvironment)
    api.startEnvironment = start
    let fetchCount = 0
    api.fetchEnvironment = async () => {
      fetchCount += 1
      return {
        environment: {
          ...environment,
          status: fetchCount === 1 ? 'awaiting_trust' : 'stopped',
        },
      }
    }
    const output: string[] = []

    const result = await runEnvironmentCommand(
      await environmentRequest(['feature/api', 'monitor']),
      5111,
      '/repo',
      (line) => output.push(line),
      vi.fn(),
      dependencies(api),
    )

    expect(result).toBe(0)
    expect(output).toEqual([
      'Runtime\thost\tawaiting_trust',
      'Review this Runtime in Taskflow, or run taskflow environment feature/api trust.',
      'Runtime\thost\tstopped',
      'Runtime stopped. Run taskflow environment feature/api start to start it again.',
    ])
    expect(start).not.toHaveBeenCalled()
  }, 10_000)

  it('waits through transient snapshot failures until the Runtime is associated', async () => {
    const api = fakeApi()
    let worktreeFetches = 0
    api.fetchWorktrees = async () => {
      worktreeFetches += 1
      if (worktreeFetches === 1) throw new Error('HTTP 500')
      return {
        worktrees: [
          {
            branch: 'feature/api',
            environmentId: environment.id,
          },
        ],
      }
    }
    let environmentFetches = 0
    api.fetchEnvironment = async () => {
      environmentFetches += 1
      return { environment: { ...environment, status: 'stopped' } }
    }
    const output: string[] = []

    const result = await runEnvironmentCommand(
      await environmentRequest(['feature/api', 'monitor']),
      5111,
      '/repo',
      (line) => output.push(line),
      vi.fn(),
      dependencies(api),
    )

    expect(result).toBe(0)
    expect(worktreeFetches).toBeGreaterThan(1)
    expect(environmentFetches).toBe(1)
    expect(output).toContain('Runtime\thost\tstopped')
  }, 10_000)
})
