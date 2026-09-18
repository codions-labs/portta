// The ceiling over a local agent.
//
// What the ceiling does to a request is decided in `portta-auth-core` and has
// its own suite. What these routes add is the operator's half: reading the list
// in force, narrowing it, and getting back to the default.

import type { Hono } from 'hono'
import { AGENT_DEFAULT_PERMISSIONS, PERMISSIONS } from 'portta-auth-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeApp, type SeededDatabase, seededDatabase } from './helpers.ts'

let seeded: SeededDatabase
let app: Hono

const json = (response: Response) => response.json() as Promise<Record<string, any>>

function put(body: unknown) {
  return app.request('/api/settings/agent-permissions', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

beforeAll(async () => {
  seeded = await seededDatabase({ empty: true })
  app = makeApp({}, {}, seeded.database).app
})

describe('reading what an agent may do', () => {
  it('answers the default, and says it is the default', async () => {
    const body = await json(await app.request('/api/settings/agent-permissions'))
    expect(body.configured).toBe(false)
    expect(body.permissions).toEqual([...AGENT_DEFAULT_PERMISSIONS])
    expect(body.defaults).toEqual([...AGENT_DEFAULT_PERMISSIONS])
    // The whole vocabulary, so the panel does not keep a copy of it.
    expect(body.available).toEqual([...PERMISSIONS])
  })
})

describe('narrowing it', () => {
  it('stores the list, sorted and without repeats', async () => {
    const body = await json(await put({ permissions: ['issue:write', 'issue:read', 'issue:read'] }))
    expect(body.permissions).toEqual(['issue:read', 'issue:write'])
    expect(body.configured).toBe(true)
    expect(await seeded.database.settings.getGlobal('agentPermissions')).toEqual(['issue:read', 'issue:write'])
  })

  it('refuses a name this panel does not know, and says which', async () => {
    const response = await put({ permissions: ['issue:read', 'task:fly'] })
    expect(response.status).toBe(400)
    expect((await json(response)).error).toMatch(/task:fly/)
  })

  it('takes an empty list as an agent that may do nothing', async () => {
    const body = await json(await put({ permissions: [] }))
    expect(body.permissions).toEqual([])
    expect(body.configured).toBe(true)
  })

  it('restores the default when the list is null', async () => {
    const body = await json(await put({ permissions: null }))
    expect(body.configured).toBe(false)
    expect(body.permissions).toEqual([...AGENT_DEFAULT_PERMISSIONS])
    expect(await seeded.database.settings.getGlobal('agentPermissions')).toBeNull()
  })
})
