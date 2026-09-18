import type { EnvironmentRecord, ResolvedEnvironment } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import {
  environmentIdForWorkspace,
  environmentRequiresTrust,
  environmentsForInstallation,
  selectEnvironmentProvider,
} from '../services/environment-coordinator.ts'

const safeEnvironment: ResolvedEnvironment = {
  provider: 'devcontainer',
  configRef: '.devcontainer/devcontainer.json',
  configHash: 'sha256:safe',
  workspace: { hostPath: '/workspace', containerPath: '/workspaces/project' },
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
    trusted: false,
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
}

describe('selectEnvironmentProvider', () => {
  it('prefers one Dev Container config in auto mode', () => {
    expect(selectEnvironmentProvider('auto', true, 1)).toBe('devcontainer')
  })

  it('keeps host as the baseline without a config', () => {
    expect(selectEnvironmentProvider(undefined, true, 0)).toBe('host')
    expect(selectEnvironmentProvider('auto', false, 1)).toBe('host')
  })

  it('falls back to Compose when Dev Container is unavailable', () => {
    expect(selectEnvironmentProvider('auto', false, 0, false, true)).toBe('compose')
  })

  it('falls back to Dockerfile after Dev Container and Compose', () => {
    expect(selectEnvironmentProvider('auto', false, 0, false, false, true)).toBe('dockerfile')
  })

  it('requires selection for multiple configs', () => {
    expect(selectEnvironmentProvider('auto', true, 2)).toBe('selection_required')
  })

  it('uses an explicitly named config when multiple configs exist', () => {
    expect(selectEnvironmentProvider('auto', true, 2, true)).toBe('devcontainer')
  })
})

describe('environmentRequiresTrust', () => {
  it('requires explicit approval for every Dev Container config', () => {
    expect(environmentRequiresTrust(safeEnvironment)).toBe(true)
  })

  it('also requires approval for risky non-Dev-Container configs', () => {
    expect(
      environmentRequiresTrust({
        ...safeEnvironment,
        provider: 'docker',
        security: { ...safeEnvironment.security, reasons: ['privileged'] },
      }),
    ).toBe(true)
  })

  it('does not require approval without a config reference', () => {
    expect(environmentRequiresTrust({ ...safeEnvironment, configRef: null })).toBe(false)
  })
})

function record(id: string, workspaceId: string, extras: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  const { scope, ...rest } = extras
  return {
    id,
    provider: 'devcontainer',
    scope: { installationId: 'install', projectId: 'project', workspaceId, ...scope },
    status: 'detected',
    desiredStatus: 'stopped',
    workspace: { hostPath: '/workspace' },
    providerRef: { schemaVersion: 1, value: {} },
    configRef: '.devcontainer/devcontainer.json',
    configHash: 'hash',
    capabilities: safeEnvironment.capabilities,
    security: safeEnvironment.security,
    error: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...rest,
  }
}

describe('environmentIdForWorkspace', () => {
  it('returns the worktree-scoped environment without probing providers', () => {
    expect(
      environmentIdForWorkspace(
        [
          record('env_run', 'wt_1', {
            scope: { installationId: 'install', projectId: 'project', workspaceId: 'wt_1', runId: 'run_1' },
          }),
          record('env_wt', 'wt_1'),
        ],
        'wt_1',
      ),
    ).toBe('env_wt')
  })

  it('ignores destroyed records and other workspaces', () => {
    expect(
      environmentIdForWorkspace(
        [record('env_gone', 'wt_1', { desiredStatus: 'destroyed' }), record('env_other', 'wt_2')],
        'wt_1',
      ),
    ).toBeNull()
  })
})

describe('environmentsForInstallation', () => {
  it('isolates records from another server serving the same project', () => {
    expect(
      environmentsForInstallation(
        [
          record('env_current', 'wt_1'),
          record('env_other_server', 'wt_2', {
            scope: { installationId: 'other-install', projectId: 'project', workspaceId: 'wt_2' },
          }),
          record('env_other_project', 'wt_3', {
            scope: { installationId: 'install', projectId: 'other-project', workspaceId: 'wt_3' },
          }),
        ],
        'project',
        'install',
      ).map((environment) => environment.id),
    ).toEqual(['env_current'])
  })
})
