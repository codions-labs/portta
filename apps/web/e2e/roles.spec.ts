import type { Page } from '@playwright/test'
import { expect, test } from './test-fixture'

// The whole matrix, on the panel that signs people in.
//
// The rules and their API refusals are tested per route in `packages/server`;
// what only this can prove is that a browser sees them: the page a role does
// not have is not in its navigation, and is a 404 when typed.
//
// One test, in sequence, for the same reason the sign-in flow is: each account
// exists because the step before it created one.

const OWNER = { email: 'ada@example.test', password: 'an-end-to-end-password' }
const PASSWORD = 'a-role-suite-password'
const PEOPLE = {
  admin: { name: 'Admin Person', email: 'admin@example.test', role: 'admin' },
  developer: { name: 'Dev Person', email: 'dev@example.test', role: 'developer' },
  viewer: { name: 'View Person', email: 'view@example.test', role: 'viewer' },
} as const

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 })
}

async function signOut(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20_000 })
}

test.describe('what each role can reach', () => {
  test('an owner makes three roles, and each one sees only its own panel', async ({ page }) => {
    test.slow()
    await signIn(page, OWNER.email, OWNER.password)

    // 1. Three accounts, through the API the Users page uses.
    for (const person of Object.values(PEOPLE)) {
      const created = await page.request.post('/api/users', {
        data: { ...person, password: PASSWORD },
      })
      expect(created.status(), person.email).toBe(201)
    }

    await signOut(page, 'Ada Lovelace')

    // 2. The administrator: the accounts are theirs to manage.
    await signIn(page, PEOPLE.admin.email, PASSWORD)
    await page.goto('/settings')
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible()
    await signOut(page, PEOPLE.admin.name)

    // 3. The developer: nothing about accounts.
    await signIn(page, PEOPLE.developer.email, PASSWORD)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/environment$/, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Environment', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Audit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'General', exact: true })).toHaveCount(0)

    // The page a role never has is not part of their panel: 404, not a door.
    await page.goto('/settings/users')
    await expect(page.locator('body')).toContainText(/404|not found|Not Found/i)
    await signOut(page, PEOPLE.developer.name)

    // 4. The viewer: the panel does not offer what it would then refuse.
    await signIn(page, PEOPLE.viewer.email, PASSWORD)
    await page.goto('/projects')
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0)
  })
})
