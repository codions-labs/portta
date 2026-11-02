#!/usr/bin/env node
// Regenerates the documentation screenshots.
//
//   npm run screenshots --workspace=portta-web -- auth-disabled
//   npm run screenshots --workspace=portta-web -- auth-enabled
//
// The images are the real panel, started by the end-to-end harness against the
// demonstration host in demo-host.mjs: no Docker, no account and no state of
// yours is read, and every run shows the same panel. Every file is written
// flat into docs/images/, prefixed with the authentication mode it shows,
// because the panel serves documentation images by file name only.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
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

const panel = await startPanel({
  mode: mode === 'auth-disabled' ? 'disabled' : 'required',
  fixture: './demo-host.mjs',
  env: { PORTTA_TCP: 'true' },
})
const base = panel.url
for (let attempt = 0; attempt < 60; attempt += 1) {
  const ready = await fetch(`${base}/api/health`)
    .then((response) => response.ok)
    .catch(() => false)
  if (ready) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}

if (mode === 'auth-disabled') {
  for (const [slug, name] of [
    ['demo-shop', 'Demo Shop'],
    ['demo-a', 'Demo A'],
    ['demo-monorepo', 'Demo Monorepo'],
  ]) {
    await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, name, description: null }),
    }).catch(() => {})
  }
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
  await page.getByLabel('Password').fill(owner.password)
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
  const state = mkdtempSync(join(tmpdir(), 'portta-docs-'))
  const publicPanel = await startPanel({
    fixture: './demo-host.mjs',
    env: { PORTTA_TCP: 'true', PORTTA_E2E_PROFILE: 'remote-public', PORTTA_E2E_STATE: state },
  })
  try {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(`${publicPanel.url}/services`, { waitUntil: 'networkidle' }).catch(() => {})
    await settle()
    await page.getByText('web', { exact: true }).first().click()
    await page.waitForTimeout(1200)
    await page
      .getByText('Exposure', { exact: false })
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {})
    await shot('exposure-closed')
    await page
      .getByRole('button', { name: /^protect/i })
      .first()
      .click()
    await page.waitForTimeout(1500)
    await shot('exposure-protected')
  } finally {
    await publicPanel.close()
    rmSync(state, { recursive: true, force: true })
  }
}

await browser.close()
await panel.close()
