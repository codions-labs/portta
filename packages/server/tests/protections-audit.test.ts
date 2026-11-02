// Protecting, opening and closing a site from the panel leaves one audit line
// each, and no line carries the password or the hash.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { describe, expect, it } from 'vitest'
import { listAudit } from '../src/services/audit.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { cheapPasswords, makeProtectedApp, seededDatabase, signInAs } from './helpers.ts'

const PASSWORD = 'a-long-enough-password'

describe('exposure changes are audited', () => {
  it('records protect, open and close, without the password or the hash', async () => {
    const seeded = await seededDatabase()
    const dir = mkdtempSync(join(tmpdir(), 'portta-exposure-audit-'))
    const panel = makeProtectedApp(
      seeded.database,
      { authStore: join(dir, 'protections.json'), dynamicDir: dir, profile: 'remote-public', tlsEnabled: true },
      {
        containers: [
          ...GATEWAY,
          ...PROJECT_A.map((container) =>
            container.id === 'a-web'
              ? {
                  ...container,
                  labels: {
                    ...container.labels,
                    'traefik.http.routers.alpha-web.rule': 'Host(`alpha-web.localhost`)',
                    'traefik.http.routers.alpha-web.middlewares': 'portta-forward-auth@file',
                  },
                }
              : container,
          ),
        ],
      },
    )
    const security = resolveSecurityMode({
      PORTTA_AUTH_MODE: 'required',
      PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
    })
    await bootstrapOwner(
      (handle) => createAuth({ db: handle, security, hasOwner: () => hasOwner(handle), password: cheapPasswords }),
      panel.db,
      { name: 'Ada', email: 'owner@example.test', password: PASSWORD },
      new Headers(),
    )
    const cookies = await signInAs(panel.auth, 'owner@example.test', PASSWORD)
    const send = (method: string, path: string) =>
      panel.app.request(path, {
        method,
        body: '{}',
        headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookies },
      })

    const protectedResponse = await send('PUT', '/api/services/a-web/exposure')
    expect(protectedResponse.status).toBe(200)
    const { password } = (await protectedResponse.json()) as { password: string }
    expect((await send('POST', '/api/services/a-web/exposure/open')).status).toBe(200)
    expect((await send('DELETE', '/api/services/a-web/exposure')).status).toBe(200)

    const { entries } = await listAudit(panel.db, { limit: 50 })
    const actions = entries.map((entry) => entry.action)
    expect(actions.filter((action) => action.startsWith('protection.')).length).toBe(3)
    expect(JSON.stringify(entries)).not.toContain(password)
    expect(JSON.stringify(entries)).not.toMatch(/\$argon|"hash"/)
  })
})
