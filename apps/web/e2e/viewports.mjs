#!/usr/bin/env node
import { startPanel } from './resources.mjs'

// Checks that the panel is usable at every width it is meant for.
//
//   node e2e/viewports.mjs            report only
//   node e2e/viewports.mjs --shots    also write the frames to /tmp for a look
//
// The one thing it asserts is the one thing that actually breaks a layout: the
// page must never scroll sideways. Anything wide — a table, a log, a
// toolbar — has to scroll inside its own container, so `document` staying
// within its viewport is the whole contract. It also fails on a control that
// ends up off-screen, because a button nobody can reach is a broken page.
//
// It boots the end-to-end harness with the larger host in demo-host.mjs, so
// what it measures is the real panel with every kind of row on screen.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

// The projects the shots are taken against. Fixed names, so an image always
// shows the same panel; the work itself lives in GitHub and is not seeded.
const DEMO_PROJECTS = [
  { slug: 'demo-shop', name: 'Demo Shop' },
  { slug: 'demo-a', name: 'Demo A' },
  { slug: 'demo-monorepo', name: 'Demo Monorepo' },
]

const SHOTS = process.argv.includes('--shots')
const OUT = '/tmp/portta-viewports'

const VIEWPORTS = [
  { name: 'desktop-wide', width: 1920, height: 1080 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'laptop-small', width: 1280, height: 800 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
]

// The pages the panel serves without an account, in rail order.
const TARGETS = [
  { name: 'overview', route: '/overview', ready: 'Demo Shop' },
  { name: 'projects', route: '/projects', ready: 'Demo Shop' },
  { name: 'environments', route: '/environments' },
  { name: 'services', route: '/services' },
  { name: 'docker', route: '/docker' },
  { name: 'network', route: '/network' },
  { name: 'access', route: '/access' },
  { name: 'gateway', route: '/gateway' },
  { name: 'settings', route: '/settings' },
  { name: 'docs', route: '/docs', ready: 'Portta docs' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check, what) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await check()) return
    } catch {
      /* not yet */
    }
    await sleep(500)
  }
  throw new Error(`${what} did not become ready`)
}

async function seedExamples() {
  for (const { slug, name } of DEMO_PROJECTS) {
    const existing = await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`)
    if (existing.status === 404) {
      await fetch(`${BASE}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, name, description: null }),
      })
    }
  }
}

const panel = await startPanel({ fixture: './demo-host.mjs', env: { PORTTA_TCP: 'true' } })
const BASE = panel.url

const problems = []

try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 'the panel')
  await waitFor(async () => (await fetch(`${BASE}/api/projects`)).ok, 'the panel database')
  await seedExamples()
  if (SHOTS) mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    for (const target of TARGETS) {
      await page.goto(BASE + target.route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
      if (target.ready) {
        await page
          .getByText(target.ready)
          .first()
          .waitFor({ timeout: 10_000 })
          .catch(() => {})
      }
      if (target.before) await target.before(page).catch(() => {})
      await page.waitForTimeout(300)

      const measured = await page.evaluate((process_all) => {
        const root = document.documentElement
        const offenders = []
        // Anything sticking out past the viewport, named so the report says
        // which element to fix rather than only that something is wrong.
        for (const element of document.querySelectorAll('body *')) {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.right > root.clientWidth + 1) {
            const style = getComputedStyle(element)
            // An element inside its own horizontal scroller is doing what it
            // was told to; only an overflow that reaches the page counts.
            let scrollable = false
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX
              if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') {
                scrollable = true
                break
              }
            }
            if (scrollable && !process_all) continue
            offenders.push({
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className.slice(0, 90) : '',
              right: Math.round(box.right),
              display: style.display,
            })
          }
        }
        // Every control must say what it is. An icon button with no name is
        // invisible to a screen reader and unnameable in a test.
        const nameless = []
        for (const control of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select')) {
          const box = control.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          const label = (
            control.getAttribute('aria-label') ||
            control.getAttribute('title') ||
            control.textContent ||
            control.labels?.[0]?.textContent ||
            (control.getAttribute('aria-labelledby')
              ? document.getElementById(control.getAttribute('aria-labelledby'))?.textContent
              : '') ||
            ''
          ).trim()
          if (label === '') {
            nameless.push(
              `${control.tagName.toLowerCase()}.${(typeof control.className === 'string' ? control.className : '').slice(0, 40)}`,
            )
          }
        }

        // Every control a person is expected to press must be on screen.
        const unreachable = []
        for (const control of document.querySelectorAll('button, a[href], input, select')) {
          const box = control.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.left < -4 || box.right > root.clientWidth + 4) {
            let scrollable = false
            for (let parent = control.parentElement; parent; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX
              if (overflow === 'auto' || overflow === 'scroll') {
                scrollable = true
                break
              }
            }
            if (scrollable) continue
            unreachable.push(
              (control.getAttribute('aria-label') || control.textContent || control.tagName).trim().slice(0, 60),
            )
          }
        }
        const main = document.querySelector('main')
        // `scrollWidth` on the root is inflated by things a person never sees
        // (a sticky cell inside a scroller is enough). What matters is whether
        // the window can actually be scrolled sideways, so that is what is
        // measured: try to, and see where it ends up.
        const before = window.scrollX
        window.scrollTo(9999, window.scrollY)
        const reached = window.scrollX
        window.scrollTo(before, window.scrollY)

        return {
          mainScroll: main ? `${main.scrollWidth}/${main.clientWidth}` : '',
          horizontalScroll: reached,
          nameless: [...new Set(nameless)].slice(0, 6),
          documentWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 6),
          unreachable: [...new Set(unreachable)].slice(0, 6),
        }
      }, Boolean(process.env.PORTTA_VIEWPORT_DEBUG))

      const label = `${viewport.name} · ${target.name}`
      const scrolls = measured.horizontalScroll > 1
      if (scrolls) {
        problems.push(
          `${label}: the page scrolls sideways by ${measured.horizontalScroll}px` +
            (measured.offenders.length > 0
              ? `\n    ${measured.offenders.map((o) => `${o.tag}.${o.className}`).join('\n    ')}`
              : ''),
        )
      }
      if (measured.unreachable.length > 0) {
        problems.push(`${label}: controls off screen — ${measured.unreachable.join(', ')}`)
      }
      // Only worth reporting once: an unnamed control is unnamed at every width.
      if (measured.nameless.length > 0 && viewport === VIEWPORTS[0]) {
        problems.push(`${target.name}: controls with no accessible name — ${measured.nameless.join(', ')}`)
      }
      if (SHOTS) await page.screenshot({ path: join(OUT, `${viewport.name}-${target.name}.png`), fullPage: false })
      const failed =
        scrolls || measured.unreachable.length > 0 || (measured.nameless.length > 0 && viewport === VIEWPORTS[0])
      process.stdout.write(`${failed ? '✗' : '✓'} ${label}\n`)
    }
    await context.close()
  }
  await browser.close()
} finally {
  await panel.close()
}

if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} layout problems:\n`)
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}
process.stdout.write('\nevery viewport fits\n')
