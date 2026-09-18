// What every route needs, and what happens when a caller does not hold it.
//
// The document is the contract, so the first two tests walk it rather than a
// list written by hand: a route added tomorrow is covered today, and a route
// that forgot to declare a permission fails here instead of answering to
// anybody who asks.

import { createPrincipalResolver, PERMISSIONS, resolveSecurityMode } from 'portta-auth-core'
import { DEV_DEMO_OWNER } from 'portta-core'
import { users } from 'portta-db'
import { describe, expect, it } from 'vitest'
import { createApi, createApp, PUBLIC_ROUTES } from '../src/api/index.ts'
import { generateOpenApi } from '../src/api/openapi.ts'
import type { AppDeps } from '../src/deps.ts'
import { GATEWAY } from './fixtures.ts'
import { databasePerFile, detachedDatabase, makeApp, makeProtectedApp, post, testConfig } from './helpers.ts'

const seededDatabase = databasePerFile()

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>

interface Operation {
  path: string
  method: string
  operationId: string
  permission: string | undefined
  authenticated: boolean
}

let generated: Promise<Operation[]> | undefined

/** Generated once for the file: every test reads the same document. */
function operations(): Promise<Operation[]> {
  generated ??= collectOperations()
  return generated
}

async function collectOperations(): Promise<Operation[]> {
  const security = resolveSecurityMode({})
  const db = detachedDatabase()
  const deps = {
    config: testConfig(),
    security,
    auth: null,
    db,
    principals: createPrincipalResolver({ security, db: db.handle, auth: null }),
  } as unknown as AppDeps
  const document = await generateOpenApi(createApi(deps), 'test')
  const found: Operation[] = []
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item as Record<string, Record<string, unknown>>)) {
      if (typeof operation?.operationId !== 'string') continue
      found.push({
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        permission: operation['x-portta-permission'] as string | undefined,
        authenticated: operation['x-portta-authenticated'] === true,
      })
    }
  }
  return found
}

describe('every operation says what it needs', () => {
  it('declares a permission, unless it is public or only needs to know who you are', async () => {
    const undeclared = (await operations())
      .filter((operation) => !operation.permission && !operation.authenticated)
      .map((operation) => `${operation.method} /api${operation.path}`)

    // The public four, and nothing else. A new name here is a route that
    // answers a stranger, which is a decision rather than an oversight.
    expect(undeclared.sort()).toEqual([...PUBLIC_ROUTES].sort())
  })

  it('names a permission that exists', async () => {
    const known = new Set<string>(PERMISSIONS)
    for (const operation of await operations()) {
      if (!operation.permission) continue
      expect(known, `${operation.operationId} needs ${operation.permission}`).toContain(operation.permission)
    }
  })

  // A read that declares a write, or a write that declares a read, is the kind
  // of mistake nothing else notices until somebody is refused or is not.
  it('never lets a GET declare a permission that changes something', async () => {
    const writes = new Set([
      'create',
      'update',
      'delete',
      'manage',
      'operate',
      'destroy',
      'write',
      'sync',
      'ban',
      'revoke',
    ])
    for (const operation of await operations()) {
      if (operation.method !== 'GET' || !operation.permission) continue
      const action = operation.permission.split(':')[1] ?? ''
      // `POST /database/migrate` is the documented exception and it is a POST,
      // so a GET holding a write permission has no explanation at all.
      expect(writes.has(action), `${operation.operationId} is a GET declaring ${operation.permission}`).toBe(false)
    }
  })
})

describe('what a request without a credential gets', () => {
  async function protectedApp() {
    const seeded = await seededDatabase({ empty: true })
    const security = resolveSecurityMode({
      PORTTA_AUTH_MODE: 'required',
      PORTTA_AUTH_SECRET: 'a-secret-long-enough-to-sign-with',
    })
    const deps = {
      config: testConfig(),
      security,
      auth: null,
      db: seeded.database,
      principals: createPrincipalResolver({ security, db: seeded.db, auth: null }),
    } as unknown as AppDeps
    return { app: createApp(deps), db: seeded.db }
  }

  // A panel with no owner has nothing to say about the host it runs on, which
  // is a different answer from "you did not sign in": there is nobody to be yet.
  it('answers 503 setup_required while there is no owner', async () => {
    const { app } = await protectedApp()
    const response = await app.request('/api/projects')
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('setup_required')
  })

  it('still answers the public routes, which a health check needs', async () => {
    const { app } = await protectedApp()
    expect((await app.request('/api/health')).status).toBe(200)
    expect(await json(await app.request('/api/auth/status'))).toMatchObject({ mode: 'protected', setupRequired: true })
  })

  // The distinction is the contract: 503 means "this panel is not ready", 401
  // means "it is, and you have not said who you are".
  it('answers 401 once there is an owner and the request carries nothing', async () => {
    const { app, db } = await protectedApp()
    // The row, not the endpoint: creating an owner properly is what
    // `bootstrap.test.ts` in packages/auth is for. What this needs is a panel
    // that is past its setup.
    await db.insert(users).values({ name: 'Ada', email: 'owner@example.test', role: 'owner' })

    const response = await app.request('/api/projects')
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBeTypeOf('string')
  })

  it('refuses the short demo password when creating the owner of an installation', async () => {
    const seeded = await seededDatabase({ empty: true })
    const { app } = makeProtectedApp(seeded.database)
    const response = await post(app, '/api/auth/setup', { ...DEV_DEMO_OWNER })
    expect(response.status).toBe(400)
  })
})

describe('open mode, where the operator is whoever asks', () => {
  // The header does not authenticate anything. What it does is hold a caller
  // that says it is an agent to what agents may do.
  it('refuses an agent the permissions agents do not hold', async () => {
    const { app } = makeApp({ containers: GATEWAY })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: {} }),
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        host: 'localhost',
        'X-Portta-Actor': 'claude-code',
      },
    })
    expect(response.status).toBe(403)
  })
})
