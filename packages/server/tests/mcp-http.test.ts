// The panel's MCP transport: off by default, and when on, the same tools
// `portta mcp` serves minus the one that reads the host, behind the same
// principal as every other route.

import type { Hono } from 'hono'
import { bootstrapOwner, createAuth, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import { HOST_ONLY_TOOL_NAMES, sharedToolNames, TASKFLOW_TOOL_NAMES } from 'portta-mcp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cheapPasswords, makeApp, makeProtectedApp, type SeededDatabase, seededDatabase, signInAs } from './helpers.ts'

const MCP_HEADERS = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
  'mcp-protocol-version': '2025-06-18',
}

interface Rpc {
  result?: {
    serverInfo?: { name: string }
    tools?: { name: string }[]
    isError?: boolean
    content?: { text: string }[]
  }
  error?: { message: string }
}

async function rpc(app: Hono, message: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/api/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(message),
  })
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
}
const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
const callTool = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name, arguments: args },
})

async function answer(response: Response): Promise<Rpc> {
  expect(response.status).toBe(200)
  return response.json() as Promise<Rpc>
}

/** What stdio serves, minus what only the host can serve: the list HTTP must serve. */
const hostOnly: readonly string[] = HOST_ONLY_TOOL_NAMES
const stdioList = [...sharedToolNames({ host: true }), ...TASKFLOW_TOOL_NAMES]
const expectedOverHttp = stdioList.filter((name) => !hostOnly.includes(name))

describe('on an open panel', () => {
  let seeded: SeededDatabase

  beforeAll(async () => {
    seeded = await seededDatabase()
  })
  afterAll(async () => {
    await seeded.close()
  })

  it('does not exist unless PORTTA_MCP_HTTP is on', async () => {
    const { app } = makeApp({}, { mcpHttp: false }, seeded.database)
    expect((await rpc(app, initialize)).status).toBe(404)
  })

  it('answers only POST: the transport keeps no session to open or close', async () => {
    const { app } = makeApp({}, { mcpHttp: true }, seeded.database)
    for (const method of ['GET', 'DELETE']) {
      const response = await app.request('/api/mcp', { method, headers: MCP_HEADERS })
      expect(response.status, method).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
      expect(((await response.json()) as { error: string }).error).toMatch(/stateless/)
    }
  })

  // The parity: HTTP serves exactly what stdio serves, minus `resolve_project`.
  it('serves the shared tools and every module tool, and nothing that reads the host', async () => {
    const { app } = makeApp({}, { mcpHttp: true }, seeded.database)
    const hello = await answer(await rpc(app, initialize))
    expect(hello.result?.serverInfo).toMatchObject({ name: 'portta' })

    const listed = await answer(await rpc(app, listTools))
    const names = (listed.result?.tools ?? []).map((tool) => tool.name)
    expect([...names].sort()).toEqual([...sharedToolNames({ host: false }), ...TASKFLOW_TOOL_NAMES].sort())
    expect([...names].sort()).toEqual([...expectedOverHttp].sort())
    expect(names).not.toContain('resolve_project')
  })

  // A tool call is the API call, for the caller that opened the exchange,
  // declared an agent whatever the request said.
  it('answers a tool call with what the API answers that caller', async () => {
    const { app } = makeApp({}, { mcpHttp: true }, seeded.database)
    const called = await answer(
      await rpc(app, callTool('list_projects'), { 'x-portta-actor': 'codex', 'x-portta-actor-kind': 'human' }),
    )
    expect(called.result?.isError).toBeUndefined()
    const viaTool = JSON.parse(called.result?.content?.[0]?.text ?? 'null') as { projects: { slug: string }[] }

    const direct = await app.request('/api/projects', {
      headers: { 'x-portta-actor': 'codex', 'x-portta-actor-kind': 'agent', 'x-portta-source': 'mcp' },
    })
    expect(direct.status).toBe(200)
    expect(viaTool).toEqual(await direct.json())
    expect(viaTool.projects.map((project) => project.slug)).toEqual(['produto'])
  })
})

describe('on a protected panel', () => {
  const PASSWORD = 'a-long-enough-password'
  let seeded: SeededDatabase
  let app: Hono
  let narrow: string

  beforeAll(async () => {
    seeded = await seededDatabase()
    const panel = makeProtectedApp(seeded.database, { mcpHttp: true })
    app = panel.app
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
    const cookie = await signInAs(panel.auth, 'owner@example.test', PASSWORD)
    const created = await app.request('/api/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'narrow', scopes: ['issue:read'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...cookie },
    })
    narrow = ((await created.json()) as { token: string }).token
  })
  afterAll(async () => {
    await seeded.close()
  })

  it('refuses the exchange itself without a credential', async () => {
    expect((await rpc(app, initialize)).status).toBe(401)
  })

  // What the token lacks is refused by the API, and the refusal is the tool's
  // answer: an agent reads why, rather than a transport failure.
  it('carries the API refusal as the tool result when the token lacks the permission', async () => {
    const bearer = { authorization: `Bearer ${narrow}` }
    const hello = await answer(await rpc(app, initialize, bearer))
    expect(hello.result?.serverInfo).toMatchObject({ name: 'portta' })

    const called = await answer(await rpc(app, callTool('list_projects'), bearer))
    expect(called.error).toBeUndefined()
    expect(called.result?.isError).toBe(true)
    expect(called.result?.content?.[0]?.text).toMatch(/^not permitted:/)
    expect(called.result?.content?.[0]?.text).toContain('project:read')
  })
})
