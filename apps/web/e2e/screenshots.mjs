#!/usr/bin/env node
// Regenerates the documentation screenshots from a running demonstration.
//
//   just dev --demo                                            # authentication disabled
//   npm run screenshots --workspace=portta-web -- auth-disabled
//
//   ./bin/portta config set panel.auth required
//   ./bin/portta web dev                                       # the panel now asks for an owner
//   npm run screenshots --workspace=portta-web -- auth-enabled  # captures /setup
//   just dev --demo                                            # creates admin@admin.com
//   npm run screenshots --workspace=portta-web -- auth-enabled  # sign-in and account pages
//
// The images are the real panel on the real demo, not fixtures: what a reader
// sees is what `just dev --demo` produces. Every file is written flat into
// docs/images/, prefixed with the authentication mode it shows, because the
// panel serves documentation images by file name only.
//
// Keep what the host daemon can read out of the shot. Start it with a `gh`
// configuration nobody is signed in to, or "Assigned to you" lists the
// operator's own GitHub issues:
//
//   GH_CONFIG_DIR="$(mktemp -d)" ./bin/portta host serve --detach

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const MODES = ['auth-disabled', 'auth-enabled']
const mode = process.argv[2]
if (!MODES.includes(mode)) {
  process.stderr.write(`usage: npm run screenshots --workspace=portta-web -- <${MODES.join('|')}>\n`)
  process.exit(2)
}

const base = process.env.PORTTA_PANEL_URL ?? 'http://127.0.0.1:8081'
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'images')
const owner = { email: 'admin@admin.com', password: 'secret' }
mkdirSync(out, { recursive: true })

const status = await (await fetch(`${base}/api/auth/status`)).json()
const expected = mode === 'auth-disabled' ? 'open' : 'protected'
if (status.mode !== expected) {
  process.stderr.write(`the panel at ${base} is ${status.mode}; ${mode} needs it ${expected}\n`)
  process.exit(3)
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
  locale: 'en-US',
})
await context.addCookies([{ name: 'portta-locale', value: 'en', url: base }])
const page = await context.newPage()

async function settle() {
  // The development build's route indicator is not part of the product.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})
  await page.waitForTimeout(1800)
}

async function go(path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
  await settle()
}

async function shot(name) {
  const file = join(out, `${mode}-${name}.png`)
  await page.screenshot({ path: file })
  process.stdout.write(`${file}\n`)
}

async function dialog(path, button, name) {
  await go(path)
  await page.getByRole('button', { name: button }).click()
  await page.waitForTimeout(1000)
  await shot(name)
}

if (mode === 'auth-disabled') {
  const pages = [
    ['overview', '/overview'],
    ['projects', '/projects'],
    ['project-overview', '/projects/demo-shop'],
    ['project-repositories', '/projects/demo-shop/repositories'],
    ['project-issues', '/projects/demo-shop/issues'],
    ['environments', '/environments'],
    ['environment', '/environments/demo-shop'],
    ['environment-logs', '/environments/demo-shop/logs'],
    ['services', '/services'],
    ['docker', '/docker'],
    ['network', '/network'],
    ['access', '/access'],
    ['gateway', '/gateway'],
    ['settings-general', '/settings/general'],
    ['settings-environment', '/settings/environment'],
    ['settings-integrations', '/settings/integrations'],
    ['settings-users', '/settings/users'],
    ['docs', '/docs'],
  ]
  for (const [name, path] of pages) {
    await go(path)
    await shot(name)
  }

  await go('/projects')
  await page.getByText('Table', { exact: true }).first().click()
  await page.waitForTimeout(1000)
  await shot('projects-table')
  // The view is remembered; leave the next run where this one started.
  await page.getByText('Cards', { exact: true }).first().click()

  await dialog('/projects', /new project/i, 'dialog-new-project')
  await dialog('/projects/demo-shop/repositories', /add repository/i, 'dialog-add-repository')

  await go('/overview')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.waitForTimeout(800)
  await shot('command-menu')

  await page.emulateMedia({ colorScheme: 'dark' })
  await go('/overview')
  await shot('overview-dark')
} else if (status.setupRequired) {
  await go('/overview')
  await shot('setup')
  process.stdout.write('the panel has no owner yet: run `just dev --demo`, then this mode again\n')
} else {
  await go('/overview')
  await shot('sign-in')
  await page.getByLabel(/email/i).fill(owner.email)
  await page.getByLabel(/password/i).fill('not-the-password')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForTimeout(1500)
  await shot('sign-in-error')
  await page.getByLabel(/password/i).fill(owner.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/overview/, { timeout: 15_000 })
  await settle()
  await shot('overview-signed-in')

  for (const name of ['users', 'tokens', 'security', 'audit']) {
    await go(`/settings/${name}`)
    await shot(`settings-${name}`)
  }
  await dialog('/settings/users', /new user/i, 'dialog-new-user')
  await dialog('/settings/tokens', /new token/i, 'dialog-new-token')
}

await browser.close()
