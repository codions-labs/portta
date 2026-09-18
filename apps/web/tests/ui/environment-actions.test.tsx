import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Environment } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeContainer, makeEnvironment, makeOperable, makeStartable } from './fixtures.ts'
import { renderWithQuery } from './render.tsx'

const environmentAction = vi.fn()
const forgetEnvironment = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    environmentAction: (...args: unknown[]) => environmentAction(...args),
    forgetEnvironment: (...args: unknown[]) => forgetEnvironment(...args),
  },
}))

beforeEach(() => {
  environmentAction.mockReset()
  forgetEnvironment.mockReset().mockResolvedValue({ ok: true, forgotten: 'alpha' })
})

const { EnvironmentActions } = await import('@/components/environment-actions')

function project(overrides: Partial<Environment> = {}): Environment {
  const services = overrides.services ?? [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', service: 'web', environment: 'alpha', state: 'exited' }),
  ]
  return {
    name: 'alpha',
    presence: 'live',
    integrated: true,
    workingDir: '/srv/dev/alpha',
    operable: makeOperable('/srv/dev/alpha'),
    startable: makeStartable(true),
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

describe('project actions', () => {
  it('disables Start when the containers are gone', () => {
    renderWithQuery(
      <EnvironmentActions
        project={project({
          services: [],
          serviceCount: 0,
          runningCount: 0,
          startable: {
            ok: false,
            reason: "this project's containers are gone; start them with the runner (PORTTA_RUNNER=true)",
            via: 'runner',
          },
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute(
      'title',
      expect.stringContaining('PORTTA_RUNNER'),
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })
})

describe('a remembered environment', () => {
  it('offers Start through the runner and Forget, never Stop or Restart', () => {
    renderWithQuery(<EnvironmentActions project={makeEnvironment({ presence: 'remembered' })} />)
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Forget' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull()
    expect(screen.queryByText(/Start it from a terminal/)).toBeNull()
  })

  it('forgets it after confirmation, then tells the page', async () => {
    const onForgotten = vi.fn()
    renderWithQuery(
      <EnvironmentActions project={makeEnvironment({ presence: 'remembered' })} onForgotten={onForgotten} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
    const dialog = await screen.findByRole('dialog', { name: 'Forget this environment?' })
    expect(dialog).toHaveTextContent('Portta stops listing alpha. Nothing on disk or in Docker changes.')
    expect(forgetEnvironment).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole('button', { name: 'Forget' }).at(-1)!)
    await waitFor(() => expect(forgetEnvironment).toHaveBeenCalledWith('alpha'))
    await waitFor(() => expect(onForgotten).toHaveBeenCalled())
  })

  it('keeps it when the dialog is cancelled', async () => {
    renderWithQuery(<EnvironmentActions project={makeEnvironment({ presence: 'remembered' })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(forgetEnvironment).not.toHaveBeenCalled()
  })
})
