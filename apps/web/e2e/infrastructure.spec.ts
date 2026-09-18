import { expect, test } from './test-fixture'

// The infrastructure pages, against the fake Docker host the harness describes.
test.describe('the infrastructure pages', () => {
  test('starts and stops an environment through the panel', async ({ page, request, engineURL }) => {
    await request.post(`${engineURL}/__reset`)

    await page.goto('/environments/alpha')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    // Stopping says what it interrupts before it does it.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled({ timeout: 20_000 })
  })
})
