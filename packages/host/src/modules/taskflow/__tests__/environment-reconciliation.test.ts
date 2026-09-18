import type { EnvironmentHandle, EnvironmentRecord, ResolvedEnvironment } from 'portta-core/taskflow'
import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentProvider, ObservedEnvironment } from '../adapters/environment-provider.ts'
import { environmentTrustPatch, reconcileEnvironment } from '../services/environment-reconciliation.ts'

function environment(
  status: EnvironmentRecord['status'],
  desiredStatus: EnvironmentRecord['desiredStatus'],
): EnvironmentRecord {
  return {
    id: 'env_1',
    provider: 'devcontainer',
    scope: { installationId: 'install', projectId: 'project', workspaceId: 'workspace' },
    status,
    desiredStatus,
    workspace: { hostPath: '/repo', containerPath: '/workspace' },
    providerRef: { schemaVersion: 1, value: { containerId: 'container' } },
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
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  }
}

function provider(observed: ObservedEnvironment): EnvironmentProvider {
  return {
    id: 'devcontainer',
    probe: async () => ({ provider: 'devcontainer', available: true, configRefs: [], diagnostics: [] }),
    resolve: async (): Promise<ResolvedEnvironment> => {
      throw new Error('unused')
    },
    start: async (): Promise<EnvironmentHandle> => {
      throw new Error('unused')
    },
    inspect: async () => observed,
    stop: vi.fn(async () => {}),
    resume: vi.fn(async (handle) => ({ ...handle, status: 'ready' })),
    rebuild: async (): Promise<EnvironmentHandle> => {
      throw new Error('unused')
    },
    destroy: vi.fn(async () => {}),
  }
}

describe('reconcileEnvironment', () => {
  it('does not inspect a provider while an explicit start is still in progress', async () => {
    const environmentProvider = provider({ status: 'missing', containerIds: [], diagnostics: ['unused'] })
    environmentProvider.inspect = vi.fn(environmentProvider.inspect)
    const starting = environment('starting', 'ready')
    starting.providerRef = { schemaVersion: 1, value: {} }

    const result = await reconcileEnvironment(starting, environmentProvider, '2026-09-10T01:00:00.000Z')

    expect(result).toBe(starting)
    expect(environmentProvider.inspect).not.toHaveBeenCalled()
  })

  it('resumes a stopped resource when desired state is ready', async () => {
    const result = await reconcileEnvironment(
      environment('ready', 'ready'),
      provider({ status: 'stopped', containerIds: ['container'], diagnostics: [] }),
      '2026-09-10T01:00:00.000Z',
    )
    expect(result.status).toBe('ready')
    expect(result.error).toBeNull()
  })

  it('marks a missing resource without recreating it', async () => {
    const result = await reconcileEnvironment(
      environment('ready', 'ready'),
      provider({ status: 'missing', containerIds: [], diagnostics: ['not found'] }),
      '2026-09-10T01:00:00.000Z',
    )
    expect(result).toMatchObject({ status: 'missing', desiredStatus: 'ready', error: 'not found' })
  })

  it('retries destruction for an owned environment left by an interrupted cleanup', async () => {
    const environmentProvider = provider({ status: 'ready', containerIds: ['container'], diagnostics: [] })
    const result = await reconcileEnvironment(
      environment('stopping', 'destroyed'),
      environmentProvider,
      '2026-09-10T01:00:00.000Z',
    )
    expect(environmentProvider.destroy).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ status: 'missing', desiredStatus: 'destroyed', error: null })
  })

  it('does not resume a detected environment even when desired state is still ready', async () => {
    const environmentProvider = provider({ status: 'stopped', containerIds: ['container'], diagnostics: [] })
    const result = await reconcileEnvironment(
      environment('detected', 'ready'),
      environmentProvider,
      '2026-09-10T01:00:00.000Z',
    )
    expect(environmentProvider.resume).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'detected', desiredStatus: 'ready' })
  })

  it('keeps a stopped failed detection diagnostic visible without inspecting an unresolved provider', async () => {
    const environmentProvider = provider({ status: 'missing', containerIds: [], diagnostics: ['unused'] })
    const failed = environment('failed', 'stopped')
    failed.error = 'No Dev Container configuration was found'

    const result = await reconcileEnvironment(failed, environmentProvider, '2026-09-10T01:00:00.000Z')

    expect(result).toBe(failed)
    expect(environmentProvider.stop).not.toHaveBeenCalled()
  })
})

describe('environmentTrustPatch', () => {
  it('preserves start intent so a trusted session can launch its runtime', () => {
    const awaiting = environment('awaiting_trust', 'ready')
    awaiting.security = { ...awaiting.security, trusted: false }
    expect(environmentTrustPatch(awaiting)).toMatchObject({
      status: 'detected',
      desiredStatus: 'ready',
      security: expect.objectContaining({ trusted: true }),
    })
  })
})
