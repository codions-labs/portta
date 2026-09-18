import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { principal, renderWithQuery } from './render.tsx'

// Better Auth's client, as far as this page is concerned. The real one talks to
// `/api/auth`; what matters here is the order the person is asked things in.
const enable = vi.fn()
const disable = vi.fn()
const verifyTotp = vi.fn()
const listSessions = vi.fn()
const revokeSession = vi.fn()
const changePassword = vi.fn()
const refetch = vi.fn()
let session: unknown = null

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: session, refetch }),
    changePassword: (...args: unknown[]) => changePassword(...args),
    listSessions: () => listSessions(),
    revokeSession: (...args: unknown[]) => revokeSession(...args),
    twoFactor: {
      enable: (...args: unknown[]) => enable(...args),
      disable: (...args: unknown[]) => disable(...args),
      verifyTotp: (...args: unknown[]) => verifyTotp(...args),
    },
  },
}))

// jsdom cannot draw a canvas, and what the QR encodes is asserted through the
// URI the dialog also prints.
vi.mock('qrcode', () => ({ toDataURL: () => Promise.resolve('data:image/png;base64,zzz') }))

const { SecurityView } = await import('../../app/(panel)/settings/security/security-view.tsx')

const me = principal({ kind: 'user', name: 'Rita', email: 'rita@example.test', role: 'developer' })

beforeEach(() => {
  session = { user: { twoFactorEnabled: false }, session: { token: 'here' } }
  enable.mockReset().mockResolvedValue({
    data: {
      method: 'totp',
      totpURI: 'otpauth://totp/Portta:rita?secret=JBSWY3DPEHPK3PXP&issuer=Portta',
      backupCodes: ['aaa-111', 'bbb-222'],
    },
    error: null,
  })
  disable.mockReset().mockResolvedValue({ data: {}, error: null })
  verifyTotp.mockReset().mockResolvedValue({ data: {}, error: null })
  changePassword.mockReset().mockResolvedValue({ data: {}, error: null })
  refetch.mockReset().mockResolvedValue(undefined)
  listSessions.mockReset().mockResolvedValue({
    data: [
      {
        id: 's-1',
        token: 'here',
        createdAt: new Date(Date.now() - 3600_000),
        expiresAt: new Date(Date.now() + 3600_000),
        ipAddress: '127.0.0.1',
        userAgent: 'Firefox',
      },
      {
        id: 's-2',
        token: 'elsewhere',
        createdAt: new Date(Date.now() - 86_400_000),
        expiresAt: new Date(Date.now() + 3600_000),
        ipAddress: '10.0.0.4',
        userAgent: 'Chrome',
      },
    ],
    error: null,
  })
  revokeSession.mockReset().mockResolvedValue({ data: {}, error: null })
})

describe('the Security settings', () => {
  it('walks the second factor from the password to the backup codes', async () => {
    renderWithQuery(<SecurityView />, undefined, me)
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    const ask = await screen.findByRole('dialog')
    await userEvent.type(within(ask).getByLabelText(/Current password/), 'my-password', { delay: null })
    await userEvent.click(within(ask).getByRole('button', { name: 'Continue' }))
    expect(enable).toHaveBeenCalledWith({ password: 'my-password', method: 'totp' })

    const scan = await screen.findByRole('dialog')
    expect(within(scan).getByAltText('QR code for your authenticator app')).toBeInTheDocument()
    // The app that cannot scan gets the secret, and never the whole URI.
    expect(within(scan).getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    await userEvent.type(within(scan).getByLabelText(/Code from the app/), '123456', { delay: null })
    await userEvent.click(within(scan).getByRole('button', { name: 'Verify' }))
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' })

    const codes = await screen.findByRole('dialog')
    expect(within(codes).getByText(/aaa-111/)).toBeInTheDocument()
    expect(within(codes).getByText(/only time they are shown/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(within(await screen.findByRole('dialog')).getByText(/aaa-111/)).toBeInTheDocument()
    await userEvent.click(within(codes).getByRole('button', { name: 'I copied it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the person on the code step when the app’s code is refused', async () => {
    verifyTotp.mockResolvedValue({ data: null, error: { message: 'invalid' } })
    renderWithQuery(<SecurityView />, undefined, me)
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    const ask = await screen.findByRole('dialog')
    await userEvent.type(within(ask).getByLabelText(/Current password/), 'my-password', { delay: null })
    await userEvent.click(within(ask).getByRole('button', { name: 'Continue' }))
    const scan = await screen.findByRole('dialog')
    await userEvent.type(within(scan).getByLabelText(/Code from the app/), '000000', { delay: null })
    await userEvent.click(within(scan).getByRole('button', { name: 'Verify' }))
    expect(await within(scan).findByRole('alert')).toHaveTextContent('Codes change every 30 seconds')
    expect(within(scan).getByLabelText(/Code from the app/)).toBeInTheDocument()
  })

  it('turns the second factor off behind the password', async () => {
    session = { user: { twoFactorEnabled: true }, session: { token: 'here' } }
    renderWithQuery(<SecurityView />, undefined, me)
    expect(screen.getByText('On')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    const ask = await screen.findByRole('dialog')
    await userEvent.type(within(ask).getByLabelText(/Current password/), 'my-password', { delay: null })
    await userEvent.click(within(ask).getByRole('button', { name: 'Continue' }))
    expect(disable).toHaveBeenCalledWith({ password: 'my-password' })
  })

  it('lists the browsers, marks this one and signs the others out', async () => {
    renderWithQuery(<SecurityView />, undefined, me)
    expect(await screen.findByText('This browser')).toBeInTheDocument()
    expect(screen.getByText('Chrome')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(revokeSession).toHaveBeenCalledWith({ token: 'elsewhere' })
  })

  it('signs the other browsers out when the password changes', async () => {
    renderWithQuery(<SecurityView />, undefined, me)
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/Current password/), 'old-password', { delay: null })
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'a-new-password', { delay: null })
    await userEvent.type(within(dialog).getByLabelText(/Repeat the password/), 'a-new-password', { delay: null })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        newPassword: 'a-new-password',
        currentPassword: 'old-password',
        revokeOtherSessions: true,
      }),
    )
  })
})
