import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Environment, EnvironmentRemovalPreview } from 'portta-contracts'
import { describe, expect, it, vi } from 'vitest'
import { makeContainer, makeOperable, makeStartable } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const rebuildEnvironment = vi.fn()
const removeEnvironment = vi.fn()
const environmentRemovalPreview = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    rebuildEnvironment: (...args: unknown[]) => rebuildEnvironment(...args),
    removeEnvironment: (...args: unknown[]) => removeEnvironment(...args),
    environmentRemovalPreview: (...args: unknown[]) => environmentRemovalPreview(...args),
    runnerProbe: async () => ({ state: 'idle', available: true, logTail: [] }),
  },
}))

const { EnvironmentOperations } = await import('@/components/environment-operations')

function project(overrides: Partial<Environment> = {}): Environment {
  const services = overrides.services ?? [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', service: 'web', environment: 'alpha', state: 'running' }),
  ]
  return {
    name: 'alpha',
    presence: 'live',
    integrated: true,
    workingDir: '/srv/dev/alpha',
    operable: makeOperable('/srv/dev/alpha'),
    startable: makeStartable(false),
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    serviceCount: services.length,
    runningCount: services.filter((service) => service.state === 'running').length,
    healthyCount: 0,
    unhealthyCount: 0,
    services,
    networks: [],
    urls: [],
    scopes: [],
    startedAt: null,
    uptimeSeconds: null,
    ...overrides,
  }
}

const preview: EnvironmentRemovalPreview = {
  environment: 'alpha',
  containers: [{ id: 'a-web', name: 'alpha-web-1', service: 'web', state: 'running', image: 'nginx' }],
  networks: ['alpha_default'],
  volumes: [{ name: 'alpha_pgdata', sizeBytes: null }],
  workingDir: '/srv/dev/alpha',
  git: { collected: false, dirty: false, staged: 0, unstaged: 0, untracked: 0 },
  records: {
    overrides: 0,
    aliases: 0,
    projectLinks: 0,
    issueLinks: 0,
    accessBridges: [],
    accessForwarders: [],
    accessFiles: [],
  },
  runnerAvailable: false,
  directoryRemovalAvailable: false,
}

describe('project operations', () => {
  it('keeps Remove disabled until the project name is typed', async () => {
    const user = userEvent.setup({ delay: null })
    environmentRemovalPreview.mockResolvedValue(preview)
    renderWithQuery(<EnvironmentOperations project={project()} />)
    await user.click(screen.getByRole('button', { name: 'Remove, keep data' }))
    expect(await screen.findByText(/GitHub repository/)).toBeInTheDocument()
    const submit = screen.getAllByRole('button', { name: 'Remove, keep data' }).at(-1)!
    expect(submit).toBeDisabled()
    await user.type(screen.getByRole('textbox'), 'alpha')
    expect(submit).toBeEnabled()
  })
})
