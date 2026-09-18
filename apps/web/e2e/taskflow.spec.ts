import { TASKFLOW_PROJECT } from './taskflow-host.mjs'
import { expect, test } from './test-fixture'

// Taskflow through the panel, end to end: a Portta Project whose repository is
// the directory the host daemon serves opens its worktrees, a terminal attached
// through the socket bridge, its Runs and its workflows — every request going
// out through `/api/modules/taskflow` to a fake daemon the panel holds a token
// for. The rail's Taskflow page names the Project the directory belongs to.

const SLUG = 'e2e-shop'

test.describe('the Taskflow pages', () => {
  test("open a Project's worktrees, terminal, Runs and workflows through the host proxy", async ({ page, request }) => {
    const created = await request.post('/api/projects', { data: { name: 'E2E Shop', slug: SLUG } })
    expect([200, 201]).toContain(created.status())
    const repository = await request.post(`/api/projects/${SLUG}/repositories`, {
      data: { name: 'shop', localPath: TASKFLOW_PROJECT.path },
    })
    expect([200, 201]).toContain(repository.status())

    // 1. Worktrees: the gate finds the Project by its repository's directory,
    // and the page opens the worktree whose session is open.
    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/modules/taskflow/${TASKFLOW_PROJECT.prefix}/api/worktrees` &&
        response.ok(),
    )
    await page.goto(`/projects/${SLUG}/worktrees`)
    await listed
    await expect(page.getByRole('tab', { name: 'Worktrees' })).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('complementary', { name: 'Taskflow sidebar' }).getByText('Checkout total'),
    ).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}/worktrees/feature%2Flogin$`), { timeout: 20_000 })
    await expect(page.locator('.xterm')).toBeVisible()
    await expect(page.locator('.xterm-rows')).toContainText('attached to feature/login', { timeout: 20_000 })

    // 2. Runs: the list is in the sidebar; picking one opens it.
    await page.getByRole('tab', { name: 'Runs' }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}/runs$`))
    await page.getByRole('button', { name: /taskflow\/login-validation/ }).click()
    await expect(page.getByRole('heading', { name: 'taskflow/login-validation' })).toBeVisible()

    // 3. Workflows: the section opens the first workflow of the catalog.
    await page.getByRole('tab', { name: 'Workflows' }).click()
    await expect(page.getByRole('heading', { name: 'Code Review' })).toBeVisible({ timeout: 20_000 })

    // 4. The registry page names the Portta Project the directory is.
    await page.goto('/taskflow')
    const row = page.getByRole('row', { name: new RegExp(TASKFLOW_PROJECT.path) })
    await expect(row.getByRole('link', { name: 'E2E Shop' })).toHaveAttribute('href', `/projects/${SLUG}/worktrees`)
  })
})
