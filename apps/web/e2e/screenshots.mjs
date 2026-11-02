#!/usr/bin/env node
// Regenerates the documentation screenshots.
//
//   npm run screenshots --workspace=portta-web -- auth-disabled
//   npm run screenshots --workspace=portta-web -- auth-enabled
//
// The images are the real panel, started by the end-to-end harness against the
// demonstration host in documentation-host.mjs: no Docker, no account and no state of
// yours is read, and every run shows the same panel. Every file is written
// flat into docs/images/, prefixed with the authentication mode it shows,
// because the panel serves documentation images by file name only.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { documentationState } from './documentation-state.mjs'
import { startPanel } from './resources.mjs'

const MODES = ['auth-disabled', 'auth-enabled']
const mode = process.argv[2]
if (!MODES.includes(mode)) {
  process.stderr.write(`usage: npm run screenshots --workspace=portta-web -- <${MODES.join('|')}>\n`)
  process.exit(2)
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'images')
const owner = { name: 'Ada Lovelace', email: 'ada@example.test', password: 'a-documentation-password' }
mkdirSync(out, { recursive: true })

const authMode = mode === 'auth-disabled' ? 'disabled' : 'required'
const state = documentationState({ mode: authMode })
const resources = []
let browser
try {
  const panel = await startPanel({ mode: authMode, fixture: './documentation-host.mjs', env: state.env })
  resources.push(panel)
  const base = panel.url
  async function seedProjects(request) {
    for (const [slug, name] of [
      ['demo-shop', 'Demo Shop'],
      ['demo-a', 'Demo A'],
      ['demo-monorepo', 'Demo Monorepo'],
    ]) {
      const response = await request(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, name, description: null }),
      })
      if (!response.ok) throw new Error(`Cannot seed ${slug}: ${response.status}`)
    }
  }
  if (mode === 'auth-disabled') await seedProjects(fetch)

  browser = await chromium.launch({ channel: process.env.PORTTA_SCREENSHOT_BROWSER_CHANNEL })
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
    const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    if (!response?.ok()) throw new Error(`Cannot capture ${path}: ${response?.status()}\n${panel.logs()}`)
    await settle()
  }

  async function shot(name) {
    const file = join(out, `${mode}-${name}.png`)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: file, animations: 'disabled' })
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
      ['environments', '/projects?view=environments'],
      ['environment', '/environments/demo-shop'],
      ['environment-logs', '/environments/demo-shop/logs'],
      ['services', '/projects?view=services'],
      ['docker', '/host/containers'],
      ['network', '/host/network'],
      ['access', '/access'],
      ['gateway', '/host/gateway'],
      ['settings-general', '/settings/general'],
      ['settings-environment', '/host'],
      ['settings-users', '/settings/users'],
      ['docs', '/docs'],
    ]
    for (const [name, path] of pages) {
      await go(path)
      await shot(name)
    }

    await dialog('/projects', /new project/i, 'dialog-new-project')

    await go('/overview')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    await page.waitForTimeout(800)
    await shot('command-menu')

    await page.emulateMedia({ colorScheme: 'dark' })
    await go('/overview')
    await shot('overview-dark')
  } else {
    await go('/overview')
    await shot('setup')
    await page.getByLabel('Name').fill(owner.name)
    await page.getByLabel('Email').fill(owner.email)
    await page.getByLabel(/^Password/).fill(owner.password)
    await page.getByRole('button', { name: 'Create owner' }).click()
    await page.waitForURL(/\/overview/, { timeout: 20_000 })
    await context.clearCookies()
    await context.addCookies([{ name: 'portta-locale', value: 'en', url: base }])
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
    await seedProjects(async (url, options) => {
      const response = await context.request.fetch(url, {
        method: options.method,
        headers: { ...options.headers, origin: base },
        data: JSON.parse(options.body),
      })
      return { ok: response.ok(), status: response.status() }
    })
    const token = await context.request.post(`${base}/api/auth/tokens`, {
      headers: { origin: base },
      data: { name: 'Documentation agent', actorKind: 'agent', expiresInDays: 30 },
    })
    if (!token.ok()) throw new Error(`Cannot seed API token: ${token.status()}`)
    await go('/overview')
    await settle()
    await shot('overview-signed-in')

    for (const name of ['users', 'tokens', 'security', 'audit']) {
      await go(`/settings/${name}`)
      await shot(`settings-${name}`)
    }
    await dialog('/settings/users', /new user/i, 'dialog-new-user')
    await dialog('/settings/tokens', /new token/i, 'dialog-new-token')
  }

  if (mode === 'auth-disabled') {
    // A public host asks who may open each site; the drawer is where it is answered.
    const publicState = documentationState({ profile: 'remote-public' })
    resources.push(publicState)
    const publicPanel = await startPanel({
      fixture: './documentation-host.mjs',
      env: publicState.env,
    })
    resources.push(publicPanel)
    try {
      await page.emulateMedia({ colorScheme: 'light' })
      await page.goto(`${publicPanel.url}/services`, { waitUntil: 'networkidle' })
      await settle()
      await page.getByText('web', { exact: true }).first().click()
      await page.waitForTimeout(1200)
      await page
        .getByRole('button', { name: /^protect/i })
        .first()
        .scrollIntoViewIfNeeded()
      await shot('exposure-closed')
      await page
        .getByRole('button', { name: /^protect/i })
        .first()
        .click()
      await page.getByRole('button', { name: /new password/i }).waitFor()
      await shot('exposure-protected')
    } finally {
      await publicPanel.close()
      resources.pop()
      publicState.close()
      resources.pop()
    }
  }
} finally {
  await browser?.close()
  for (const resource of resources.reverse()) await resource.close()
  state.close()
}
