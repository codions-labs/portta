import type { EnvironmentRecord } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import type { ProcessRunner, RunningProcess } from '../adapters/process-runner.ts'
import { DockerServiceDiscoverySource, mergeEnvironmentServices } from '../services/environment-service-discovery.ts'

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller): void {
      if (value) controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}

function successful(stdout: string): RunningProcess {
  return {
    pid: 1,
    stdout: stream(stdout),
    stderr: stream(''),
    exited: Promise.resolve({ code: 0, signal: null, timedOut: false }),
    writeStdin: async (): Promise<void> => {},
    closeStdin: (): void => {},
    kill: (): boolean => true,
  }
}

function environment(): EnvironmentRecord {
  const now = '2026-09-10T00:00:00.000Z'
  return {
    id: 'env_test',
    provider: 'devcontainer',
    scope: { installationId: 'local', projectId: 'project', workspaceId: 'workspace' },
    status: 'ready',
    desiredStatus: 'ready',
    workspace: { hostPath: '/repo', containerPath: '/workspaces/repo' },
    providerRef: {
      schemaVersion: 1,
      value: {
        containerId: 'primary',
        composeProjectName: 'tf_test',
        mergedConfiguration: {
          forwardPorts: ['backend:8080', 'postgres:5432'],
          portsAttributes: { '8080': { protocol: 'http', label: 'API' } },
        },
      },
    },
    configRef: '.devcontainer/devcontainer.json',
    configHash: 'hash',
    capabilities: {
      exec: true,
      stdin: true,
      pty: true,
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
    createdAt: now,
    updatedAt: now,
  }
}

describe('DockerServiceDiscoverySource', () => {
  it('discovers the primary container, Compose sidecars, health, ports, and provenance', async () => {
    const outputs = [
      'primary\npostgres-id\n',
      JSON.stringify([
        {
          Id: 'primary',
          Name: '/backend',
          Config: { Labels: { 'com.docker.compose.service': 'backend' }, ExposedPorts: { '8080/tcp': {} } },
          State: { Status: 'running', Health: { Status: 'healthy' } },
          NetworkSettings: { Ports: { '8080/tcp': null } },
        },
        {
          Id: 'postgres-id',
          Name: '/postgres',
          Config: { Labels: { 'com.docker.compose.service': 'postgres' }, ExposedPorts: { '5432/tcp': {} } },
          State: { Status: 'running', Health: { Status: 'starting' } },
          NetworkSettings: { Ports: { '5432/tcp': null } },
        },
      ]),
    ]
    const runner: ProcessRunner = { start: () => successful(outputs.shift() ?? '') }
    const services = await new DockerServiceDiscoverySource(runner).discover(environment())
    expect(services.map((service) => service.name)).toEqual(['backend', 'postgres'])
    expect(services[0]).toMatchObject({ status: 'running', kind: 'http' })
    expect(services[0]?.ports[0]).toMatchObject({ containerPort: 8080, protocol: 'http', label: 'API' })
    expect(services[0]?.endpoints[0]).toMatchObject({ url: 'http://127.0.0.1:8080', executionLocus: 'environment' })
    expect(services[1]).toMatchObject({ status: 'starting', kind: 'database' })
    expect(services[1]?.endpoints[0]?.url).toBe('tcp://postgres:5432')
    expect(services[1]?.provenance.map((item) => item.source)).toEqual(['docker', 'compose', 'devcontainer'])
  })

  it('merges sources by stable service identity', () => {
    const base = environment()
    const service = {
      id: 'service_env_test_api',
      environmentId: base.id,
      name: 'api',
      status: 'unknown' as const,
      kind: 'unknown' as const,
      containerIds: [],
      ports: [],
      endpoints: [],
      provenance: [{ source: 'taskflow' as const, detail: 'manual', confidence: 'explicit' as const }],
    }
    const merged = mergeEnvironmentServices([[service], [{ ...service, status: 'running', kind: 'http' }]])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ status: 'running', kind: 'http' })
    expect(merged[0]?.provenance).toEqual(service.provenance)
  })
})
