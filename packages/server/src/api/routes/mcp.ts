// The panel's MCP transport: the shared tools over Streamable HTTP.
//
// For an agent that has no CLI where it runs — a Dev Container, a remote
// worktree, a cloud runner. `POST /api/mcp` is one JSON-RPC exchange per
// request, stateless, behind the same principal as every other route. Each
// tool call re-enters this API as the caller, declared an agent: in open mode
// that is the `agentPermissions` ceiling, in protected mode the token already
// decided. Off unless `PORTTA_MCP_HTTP=true`, and reachable from wherever the
// panel is (ADR 0054).
//
// Not a JSON API route, so it is not in the OpenAPI document: what it speaks is
// JSON-RPC, described by the MCP specification rather than by a schema here.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Context, Hono } from 'hono'
import { principalOf } from 'portta-auth-core/hono'
import {
  type ApiCaller,
  describeFailure,
  type HttpMethod,
  registerSharedTools,
  remoteDocumentationReader,
} from 'portta-mcp'
import type { AppDeps } from '../../deps.ts'
import { registerModuleTools, SERVER_MODULES } from '../../modules/index.ts'

/** The same shape `portta-auth-core` accepts for `X-Portta-Actor`; anything else would resolve as nobody. */
const ACTOR = /^[A-Za-z0-9._-]{1,64}$/

interface Answer {
  ok: boolean
  status: number
  text: string
}

type Reentry = (method: HttpMethod, path: string, body?: unknown) => Promise<Answer>

/**
 * One request back into this API, as the caller.
 *
 * The credential is forwarded as it came, so the principal each tool call
 * resolves is the one that opened the exchange. The actor is the one already
 * resolved, and the kind is always `agent`: a caller cannot claim to be a
 * person through this transport, which is what keeps the ceiling in force on
 * an open panel. No `Origin` is sent, so the same-origin guard treats each
 * call as the non-browser client it is.
 */
function reenter(api: Hono, incoming: Request, actor: string): Reentry {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-Portta-Actor': ACTOR.test(actor) ? actor : 'agent',
    'X-Portta-Actor-Kind': 'agent',
    'X-Portta-Source': 'mcp',
  }
  for (const name of ['authorization', 'cookie'] as const) {
    const value = incoming.headers.get(name)
    if (value) headers[name] = value
  }
  return async (method, path, body) => {
    const response = await api.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { ok: response.ok, status: response.status, text: await response.text() }
  }
}

/** A refusal is a tool result carrying the API's words, never a transport error. */
function callerOf(request: Reentry): ApiCaller {
  return async (method, path, body) => {
    const answer = await request(method, path, body)
    if (!answer.ok)
      return { content: [{ type: 'text', text: describeFailure(answer.status, answer.text) }], isError: true }
    return { content: [{ type: 'text', text: answer.text }] }
  }
}

function stateless(c: Context) {
  c.header('allow', 'POST')
  return c.json(
    {
      error: 'this MCP transport is stateless: send each JSON-RPC message with POST',
      hint: 'there is no session to open or close',
    },
    405,
  )
}

export function mcpRoutes(deps: AppDeps, api: Hono): void {
  api.get('/mcp', stateless)
  api.delete('/mcp', stateless)
  api.post('/mcp', async (c) => {
    const request = reenter(api, c.req.raw, principalOf(c).actor)
    const call = callerOf(request)
    // One server per exchange: the transport keeps no session, and a server
    // shared across callers would have to keep none of their credentials.
    const server = new McpServer({ name: 'portta', version: deps.config.gatewayVersion })
    registerSharedTools(server, call, {
      documentation: remoteDocumentationReader(async (path) => {
        const answer = await request('GET', path)
        if (!answer.ok) throw new Error(describeFailure(answer.status, answer.text))
        return JSON.parse(answer.text) as unknown
      }),
      documentationOrigin: 'panel',
    })
    registerModuleTools(server, call, deps.modules ?? SERVER_MODULES)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(c.req.raw)
  })
}
