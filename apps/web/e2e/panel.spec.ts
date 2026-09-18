import { expect, test } from './test-fixture'

// The panel, driven in a browser against a fake Docker Engine API and a real
// SQLite database. What is asserted here is what only a browser can tell you: that
// the shell renders, that the pages are reachable, and that the preferences
// survive a reload.
//
// This covers the Overview and the panel's API and websocket contracts. The
// pages for projects, environments and settings have their own specs.

// This panel runs with PORTTA_AUTH_MODE=disabled, which is the documented
// default: on loopback there is nobody to sign in as, and the overview opens
// straight away. `auth.spec.ts` drives the other mode, on its own panel.
test.describe('the panel end to end', () => {
  // Every test describes the same host, whatever the previous one did to it.
  test.beforeEach(async ({ request, engineURL }) => {
    await request.post(`${engineURL}/__reset`)
  })

  test('opens on the overview, rendered by the server, with the API beside it', async ({ page, request }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/overview$/)

    // The route name is the page's h1 for a screen reader; what a person sees
    // at the top is the host, so the heading is asserted present, not visible.
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeAttached()
    await expect(page.getByText('Gateway running')).toBeVisible()
    await expect(page).toHaveTitle('Overview · Portta')

    // No browser in the way: what arrives is what the server rendered. A page
    // that needed the client to fetch its own API would be blank here.
    const html = await request.get('/overview')
    expect(html.status()).toBe(200)
    expect(await html.text()).toContain('Needs attention')

    // One process, one origin: a session cookie set by the pages is the same
    // cookie the API sees, which is the reason the panel is not two servers.
    const health = await request.get('/api/health')
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true })
    expect((await request.get('/api/openapi.json')).status()).toBe(200)
  })

  // Set in `next.config.ts`, and only a real response proves they arrive: the
  // panel can start, stop and remove containers, so nothing may frame it and
  // nothing may guess at a response's type.
  test('carries its security headers on a page', async ({ request }) => {
    const response = await request.get('/overview')
    const headers = response.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('no-referrer')
  })

  test('and never lets the API be cached', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
  })

  test('streams an environment log over a websocket', async ({ page }) => {
    await page.goto('/overview')
    // From the page, so the handshake carries whatever a browser would carry.
    const received = await page.evaluate(async () => {
      const socket = new WebSocket(`ws://${location.host}/ws/environments/alpha/logs?service=web&tail=10`)
      return await new Promise<string[]>((resolve, reject) => {
        const messages: string[] = []
        socket.onmessage = (event) => {
          messages.push(String(event.data))
          if (messages.length >= 1) {
            socket.close()
            resolve(messages)
          }
        }
        socket.onerror = () => reject(new Error('the socket refused the handshake'))
        setTimeout(() => resolve(messages), 5_000)
      })
    })
    expect(received.length).toBeGreaterThan(0)
    expect(JSON.parse(received[0]!)).toMatchObject({ kind: 'open', environment: 'alpha' })
  })
})
