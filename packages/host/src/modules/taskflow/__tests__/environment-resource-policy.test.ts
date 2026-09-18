import type { EnvironmentHandle } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import type { ProcessRunner, ProcessSpec, RunningProcess } from '../adapters/process-runner.ts'
import { applyEnvironmentResourcePolicy, hasEnvironmentCapacity } from '../services/environment-resource-policy.ts'

function stream(value = ''): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (value) controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}

class FakeRunner implements ProcessRunner {
  readonly calls: ProcessSpec[] = []

  start(spec: ProcessSpec): RunningProcess {
    this.calls.push(spec)
    const output =
      spec.args[0] === 'ps'
        ? 'primary\npostgres\n'
        : spec.args[0] === 'inspect'
          ? '4000000000 8589934592 8589934592 1024\n'
          : ''
    return {
      pid: 1,
      stdout: stream(output),
      stderr: stream(),
      exited: Promise.resolve({ code: 0, signal: null, timedOut: false }),
      writeStdin: async () => {},
      closeStdin: () => {},
      kill: () => true,
    }
  }
}

const handle: EnvironmentHandle = {
  id: 'env_a',
  provider: 'devcontainer',
  scope: { installationId: 'install', projectId: 'project', workspaceId: 'workspace' },
  status: 'ready',
  workspace: { hostPath: '/repo', containerPath: '/workspace' },
  providerRef: { schemaVersion: 1, value: { containerId: 'primary', composeProjectName: 'tf_env_a' } },
}

describe('applyEnvironmentResourcePolicy', () => {
  it('limits and validates every Compose container and records override provenance', async () => {
    const runner = new FakeRunner()
    const limited = await applyEnvironmentResourcePolicy(runner, handle)

    expect(runner.calls.find((call) => call.args[0] === 'update')?.args).toEqual([
      'update',
      '--cpus',
      '4',
      '--memory',
      '8g',
      '--memory-swap',
      '8g',
      '--pids-limit',
      '1024',
      'primary',
      'postgres',
    ])
    expect(limited.providerRef.value.runtimeOverride).toMatchObject({
      path: 'docker:update',
      diff: ['cpus=4', 'memory=8g', 'memory-swap=8g', 'pids=1024'],
      validated: true,
    })
  })

  it('excludes host, missing and failed records from the project concurrency quota', () => {
    const base = {
      ...handle,
      desiredStatus: 'ready' as const,
      configRef: 'config',
      configHash: 'hash',
      capabilities: {
        exec: true,
        stdin: true,
        pty: false,
        resize: false,
        signals: true,
        reattach: false,
        services: true,
        rebuild: true,
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
    expect(hasEnvironmentCapacity([{ ...base, id: 'one' }], 'new', 1)).toBe(false)
    expect(hasEnvironmentCapacity([{ ...base, id: 'one', status: 'missing' }], 'new', 1)).toBe(true)
    expect(hasEnvironmentCapacity([{ ...base, id: 'one', provider: 'host' }], 'new', 1)).toBe(true)
  })
})
