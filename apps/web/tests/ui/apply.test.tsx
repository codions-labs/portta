import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ApplyStatus } from 'portta-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const applyStatus = vi.fn()
const applyProbe = vi.fn()
const healthProbe = vi.fn()
const apply = vi.fn()
const discardConfig = vi.fn()

class ApiError extends Error {
  status: number
  hint = ''
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

vi.mock('@/lib/api/index', () => ({
  ApiError,
  api: {
    applyStatus: () => applyStatus(),
    applyProbe: (signal: AbortSignal) => applyProbe(signal),
    healthProbe: (signal: AbortSignal) => healthProbe(signal),
    apply: () => apply(),
    discardConfig: (...args: unknown[]) => discardConfig(...args),
  },
}))

const { ApplyBar } = await import('@/components/apply-bar')

const DOMAIN_CHANGE = {
  key: 'PORTTA_DOMAIN',
  label: 'Domain',
  group: 'Project domain',
  from: 'localhost',
  to: 'dev.test',
  secret: false,
  fromSet: true,
  toSet: true,
  restartRequired: true,
}

const IDLE: ApplyStatus = {
  state: 'idle',
  available: true,
  reason: null,
  unavailableReason: null,
  buildsImages: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  pendingRestart: true,
  pendingKeys: ['PORTTA_DOMAIN'],
  pendingChanges: [DOMAIN_CHANGE],
  movesPanel: false,
  logTail: [],
  profile: 'local',
  applyCommand: './bin/portta up local',
}

const SETTLED: ApplyStatus = {
  ...IDLE,
  state: 'ok',
  pendingRestart: false,
  pendingKeys: [],
  pendingChanges: [],
  exitCode: 0,
}

beforeEach(() => {
  applyStatus.mockReset().mockResolvedValue(IDLE)
  applyProbe.mockReset().mockResolvedValue(SETTLED)
  healthProbe.mockReset().mockResolvedValue({ ok: true, panelVersion: '0.1.0', gatewayVersion: '0.3.0' })
  apply.mockReset().mockResolvedValue({ ok: true, startedAt: 1, note: '', applyCommand: './bin/portta up local' })
  discardConfig.mockReset().mockResolvedValue({
    ok: true,
    discarded: ['PORTTA_DOMAIN'],
    pendingRestart: false,
    applyCommand: './bin/portta up local',
    view: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Advance the fake clock, letting the poll's awaits and React's renders run.
 * `userEvent` and `findBy*` both wait on timers of their own, which are faked
 * here and would never fire, so the polling tests below use `fireEvent` and
 * step the clock explicitly instead.
 */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

/** Open the dialog and confirm, on a fake clock. */
async function startApplying(): Promise<void> {
  vi.useFakeTimers()
  renderWithQuery(<ApplyBar readOnly={false} />)
  await tick(10)
  await click('Apply')
  await click('Apply')
}

describe('the pending bar', () => {
  it('says nothing when the running gateway agrees with what is saved', async () => {
    applyStatus.mockResolvedValue({ ...IDLE, pendingRestart: false, pendingKeys: [], pendingChanges: [] })
    renderWithQuery(<ApplyBar readOnly={false} />)
    await waitFor(() => expect(applyStatus).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('falls back to the host command when the host has no applier', async () => {
    applyStatus.mockResolvedValue({
      ...IDLE,
      state: 'unavailable',
      available: false,
      reason: 'set PORTTA_APPLY=true on the host, then run the command once',
      unavailableReason: 'disabled',
    })
    renderWithQuery(<ApplyBar readOnly={false} />)
    expect(await screen.findByText('./bin/portta up local')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(screen.getByText(/Set PORTTA_APPLY=true/)).toBeInTheDocument()
  })

  // The bug this replaced: the bar told an operator who had already set the key
  // to set the key, because one fixed sentence covered three situations.
  it('does not tell an operator to set a key that is already set', async () => {
    applyStatus.mockResolvedValue({
      ...IDLE,
      state: 'unavailable',
      available: false,
      reason: 'PORTTA_APPLY is true, but the applier has not been prepared yet: run the command once',
      unavailableReason: 'not-prepared',
      buildsImages: true,
    })
    renderWithQuery(<ApplyBar readOnly={false} />)
    expect(await screen.findByText(/already on/)).toBeInTheDocument()
    expect(screen.queryByText(/Set PORTTA_APPLY=true/)).not.toBeInTheDocument()
  })

  it('offers no button in read-only mode, only the command', async () => {
    renderWithQuery(<ApplyBar readOnly />)
    expect(await screen.findByText('./bin/portta up local')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
  })
})

describe('the confirmation', () => {
  it('names what is pending, and does not apply until confirmed', async () => {
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(screen.getByText('Your domain')).toBeInTheDocument()
    expect(screen.getByText('localhost')).toBeInTheDocument()
    expect(screen.getByText('dev.test')).toBeInTheDocument()
    expect(screen.getByText(/goes offline for a few seconds/)).toBeInTheDocument()
    expect(screen.getByText(/projects are not touched/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apply).not.toHaveBeenCalled()
  })

  it('discards a pending change without applying', async () => {
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard all' }))
    expect(discardConfig).toHaveBeenCalledWith(undefined)
    expect(apply).not.toHaveBeenCalled()
  })

  it('warns when the panel is about to move, because this tab will not come back', async () => {
    applyStatus.mockResolvedValue({
      ...IDLE,
      movesPanel: true,
      pendingKeys: ['PORTTA_WEB_PORT'],
      pendingChanges: [
        {
          ...DOMAIN_CHANGE,
          key: 'PORTTA_WEB_PORT',
          label: 'Port',
          from: '8081',
          to: '9090',
        },
      ],
    })
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(screen.getByText(/will not reconnect on its own/)).toBeInTheDocument()
  })
})

describe('applying', () => {
  it('cannot be dismissed while it runs', async () => {
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await screen.findByText('Do not close this tab. The panel comes back on its own.')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('treats the panel going away as progress, and reports success when it answers again', async () => {
    // This is the whole point of the dialog: while the gateway is being
    // recreated the panel is unreachable, and a fetch rejection there means
    // "working", not "broken".
    //
    // The poll is a plain `setTimeout` loop precisely so a test can drive it:
    // on the real clock this waits two poll rounds plus the five-second grace,
    // which was eight of the ten seconds the whole panel suite took.
    healthProbe
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, panelVersion: '0.1.0', gatewayVersion: '0.3.0' })

    await startApplying()

    // Two rounds of the poll: both find the panel gone. The dialog has to say
    // it is waiting for the panel, not that something went wrong — asserting
    // the phase rather than the step label, because the step list is rendered
    // in full throughout and only its icons change.
    await tick(4_000)
    expect(screen.getByText(/The panel is restarting/)).toBeInTheDocument()

    // The third answers, and by now the grace period has passed, so a settled
    // status is believed rather than read as "Compose has not started yet".
    await tick(4_000)
    expect(screen.getByText(/The saved settings are running/)).toBeInTheDocument()
  })

  it('shows the exit code and the output when the applier failed', async () => {
    applyProbe.mockResolvedValue({
      ...IDLE,
      state: 'failed',
      exitCode: 2,
      startedAt: 1,
      finishedAt: 2,
      logTail: ['error: could not create the shared network'],
    })

    await startApplying()

    await tick(4_000)
    expect(screen.getByText(/exited with code 2/)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('Show output'))
    })
    expect(screen.getByText(/could not create the shared network/)).toBeInTheDocument()
  })
})

describe('an apply that was already running', () => {
  it('reopens the progress dialog, counting from the host clock', async () => {
    // A reload mid-apply, or a second tab. The state is the applier's, so this
    // needs no memory in the browser.
    const startedAt = Math.floor(Date.now() / 1000) - 42
    applyStatus.mockResolvedValue({ ...IDLE, state: 'running', startedAt })
    applyProbe.mockResolvedValue({ ...IDLE, state: 'running', startedAt })

    renderWithQuery(<ApplyBar readOnly={false} />)
    await screen.findByText('Do not close this tab. The panel comes back on its own.')
    expect(await screen.findByText(/^0[01]:4[0-9]$/)).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
  })
})
