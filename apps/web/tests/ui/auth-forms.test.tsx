// The two pages somebody sees before they are anybody.
//
// What matters here is not the styling: it is that the setup form posts to
// Portta's own endpoint, that a refusal is shown rather than swallowed, and that
// a wrong password says the same thing whichever half was wrong.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupForm } from '@/app/(auth)/setup/setup-form'
import { SignInForm } from '@/app/(auth)/sign-in/sign-in-form'
import { renderWithQuery } from './render.tsx'

const push = vi.fn()
const refresh = vi.fn()
const signInEmail = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('@/lib/auth-client', () => ({
  signIn: { email: (...args: unknown[]) => signInEmail(...args) },
  signOut: vi.fn(),
  authClient: {},
}))

beforeEach(() => {
  push.mockReset()
  refresh.mockReset()
  signInEmail.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: { status: number; body?: unknown }) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(response.body ?? {}), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function fillSetup() {
  const user = userEvent.setup({ delay: null })
  await user.type(screen.getByLabelText(/name/i), 'Ada Lovelace')
  await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
  await user.type(screen.getByLabelText(/password/i), 'a-long-enough-password')
  await user.click(screen.getByRole('button', { name: /create owner/i }))
}

describe('the setup form', () => {
  it('creates the owner, signs them in, and lands on the panel', async () => {
    const fetch = stubFetch({
      status: 201,
      body: { ok: true, user: { id: 'u1', email: 'ada@example.com', name: 'Ada' } },
    })
    signInEmail.mockResolvedValue({ data: {}, error: null })
    renderWithQuery(<SetupForm />, 'en')

    await fillSetup()

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/auth/setup', expect.objectContaining({ method: 'POST' })),
    )
    expect(signInEmail).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'a-long-enough-password' })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/overview'))
  })

  // Two people opening /setup at the same moment: one owner, one 409, and the
  // second is told what happened rather than left looking at a form.
  it('says the panel already has an owner on a 409', async () => {
    stubFetch({ status: 409, body: { error: 'this installation already has an owner' } })
    renderWithQuery(<SetupForm />, 'en')

    await fillSetup()

    expect(await screen.findByRole('alert')).toHaveTextContent(/already has an owner/i)
    expect(push).not.toHaveBeenCalled()
  })
})

describe('the sign-in form', () => {
  it('goes to the second factor when the account has one', async () => {
    signInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    renderWithQuery(<SignInForm />, 'en')
    const user = userEvent.setup({ delay: null })
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/password/i), 'a-long-enough-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/two-factor'))
  })

  // Telling somebody the email exists is telling them which one to keep
  // guessing, so both halves fail with one sentence.
  it('says the same thing whichever half was wrong', async () => {
    signInEmail.mockResolvedValue({ data: null, error: { message: 'Invalid password' } })
    renderWithQuery(<SignInForm />, 'en')
    const user = userEvent.setup({ delay: null })
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/password/i), 'wrong-password-here')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match an account here/i)
    expect(push).not.toHaveBeenCalled()
  })
})
