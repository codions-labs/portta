import { expect, test } from './test-fixture'

// Signing in, against the second panel: the same build, started with
// PORTTA_AUTH_MODE=required and its own database.
//
// The whole sequence in one test, deliberately. Creating the owner happens once
// per panel, so a second test could not repeat it, and splitting the flow would
// mean each half depended on the other having run.

const OWNER = {
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  password: 'an-end-to-end-password',
}

test.describe('a panel that asks who you are', () => {
  test('goes setup, sign-in, overview, and refuses everything in between', async ({ page, request }) => {
    // 1. Nothing is answered about the host while there is no owner.
    const status = await request.get('/api/auth/status')
    expect(status.status()).toBe(200)
    expect(await status.json()).toMatchObject({ mode: 'protected', setupRequired: true })

    const beforeSetup = await request.get('/api/projects')
    expect(beforeSetup.status()).toBe(503)
    expect((await beforeSetup.json()).code).toBe('setup_required')

    // Liveness still answers: it is what a container health check calls.
    expect((await request.get('/api/health')).status()).toBe(200)

    // 2. Every page is /setup until there is one.
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/setup$/)

    // 3. The owner is created, and the panel opens.
    await page.getByLabel('Name').fill(OWNER.name)
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByRole('button', { name: 'Create owner' }).click()

    await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeAttached()

    // 4. A second setup is refused, whoever asks.
    const again = await request.post('/api/auth/setup', { data: OWNER })
    expect(again.status()).toBe(409)

    // 5. A request with no cookie is 401 now, not 503: the panel is ready, the
    //    caller has not said who they are.
    const anonymous = await request.get('/api/projects', { headers: { cookie: '' } })
    expect(anonymous.status()).toBe(401)

    // 6. The browser, which does have the cookie, is the owner.
    const me = await page.request.get('/api/auth/me')
    expect(me.status()).toBe(200)
    expect(await me.json()).toMatchObject({ kind: 'user', role: 'owner', email: OWNER.email })

    // 7. Signing out ends it, and the panel asks again.
    await page.getByRole('button', { name: OWNER.name }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20_000 })

    await page.goto('/overview')
    await expect(page).toHaveURL(/\/sign-in$/)

    // 8. And signing back in returns to the panel.
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill(OWNER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 })
  })

  test('says nothing useful about a password that is wrong', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Scoped to the form: Next's own route announcer is also a live region.
    await expect(page.locator('form').getByRole('alert')).toContainText('do not match an account here')
    await expect(page).toHaveURL(/\/sign-in$/)
  })
})
