import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEnvironmentStore } from '../adapters/environment-store.ts'

describe('EnvironmentStore', () => {
  it('persists environments and hash-scoped trust', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-environment-store-'))
    const store = createEnvironmentStore(join(directory, 'taskflow.db'))
    const now = new Date().toISOString()
    store.save({
      id: 'env_1',
      provider: 'host',
      scope: { installationId: 'local', projectId: 'project', workspaceId: 'workspace' },
      status: 'ready',
      desiredStatus: 'ready',
      workspace: { hostPath: '/workspace' },
      providerRef: { schemaVersion: 1, value: {} },
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
      createdAt: now,
      updatedAt: now,
    })
    expect(store.get('env_1')?.scope.workspaceId).toBe('workspace')
    expect(store.isTrusted('project', '.devcontainer/devcontainer.json', 'a')).toBe(false)
    store.trust('project', '.devcontainer/devcontainer.json', 'a')
    expect(store.isTrusted('project', '.devcontainer/devcontainer.json', 'a')).toBe(true)
    expect(store.isTrusted('project', '.devcontainer/devcontainer.json', 'b')).toBe(false)
    store.replaceServices('env_1', [
      {
        id: 'service_env_1_api',
        environmentId: 'env_1',
        name: 'api',
        status: 'running',
        kind: 'http',
        containerIds: [],
        ports: [{ containerPort: 8080, protocol: 'http' }],
        endpoints: [
          {
            id: 'endpoint_api',
            serviceId: 'service_env_1_api',
            url: 'http://api:8080',
            audiences: ['agent'],
            visibility: 'environment',
            accessMode: 'internal',
            executionLocus: 'environment',
            stable: true,
          },
        ],
        provenance: [{ source: 'taskflow', detail: 'test', confidence: 'explicit' }],
      },
    ])
    expect(store.getService('env_1', 'service_env_1_api')?.endpoints[0]?.url).toBe('http://api:8080')
    expect(store.listServices('env_1')).toHaveLength(1)
    store.close()
    await rm(directory, { recursive: true, force: true })
  })
})
