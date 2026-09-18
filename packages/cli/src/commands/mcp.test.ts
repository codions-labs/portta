import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sharedToolNames, TASKFLOW_TOOL_NAMES } from 'portta-mcp'
import { describe, expect, it, vi } from 'vitest'
import { RefusedError } from '../errors.js'
import { createCaller, describeFailure, isLoopbackUrl, panelHeaders, registerCliTools, resolvePanelUrl } from './mcp.ts'

describe('where the panel is', () => {
  it('defaults to the local panel on its configured port', () => {
    expect(resolvePanelUrl({}, {}, '8081')).toBe('http://127.0.0.1:8081')
    expect(resolvePanelUrl({ PORTTA_WEB_PORT: '9000' }, {}, '9000')).toBe('http://127.0.0.1:9000')
  })

  it('takes an explicit URL or PORTTA_URL and trims a trailing slash', () => {
    expect(resolvePanelUrl({}, { url: 'http://localhost:8081/' }, '8081')).toBe('http://localhost:8081')
    expect(resolvePanelUrl({ PORTTA_URL: 'http://[::1]:8081' }, {}, '8081')).toBe('http://[::1]:8081')
  })

  // The failure worth designing for is a misconfigured URL sending a panel
  // credential somewhere unintended.
  it('refuses a non-loopback panel without an explicit flag', () => {
    expect(() => resolvePanelUrl({}, { url: 'https://panel.example.com' }, '8081')).toThrow(RefusedError)
    expect(() => resolvePanelUrl({}, { url: 'https://panel.example.com' }, '8081')).toThrowError(
      /refusing to send a panel credential/,
    )
    expect(resolvePanelUrl({}, { url: 'https://panel.example.com', allowRemote: true }, '8081')).toBe(
      'https://panel.example.com',
    )
  })

  it('refuses a URL it cannot even parse rather than assuming it is local', () => {
    expect(() => resolvePanelUrl({}, { url: 'not a url' }, '8081')).toThrow(RefusedError)
  })

  it('knows loopback from everything else', () => {
    for (const url of ['http://127.0.0.1:8081', 'http://localhost:1', 'http://[::1]:8081']) {
      expect(isLoopbackUrl(url), url).toBe(true)
    }
    for (const url of ['http://10.0.0.1', 'https://example.com', 'http://127.0.0.1.evil.com', '']) {
      expect(isLoopbackUrl(url), url).toBe(false)
    }
  })
})

describe('panelHeaders', () => {
  // A panel in `disabled` mode needs no credential, and sending one would be a
  // secret in a request that never needed it.
  it('sends a credential only when there is one', () => {
    expect(panelHeaders({}, 'a').authorization).toBeUndefined()
  })

  it('sends the Bearer token the environment names', () => {
    const headers = panelHeaders({ PORTTA_TOKEN: 'ptt_secret' }, 'codex')
    expect(headers.authorization).toBe('Bearer ptt_secret')
    expect(headers['X-Portta-Source']).toBe('cli')
  })

  // The one for this invocation wins: `--token` is the most explicit thing a
  // person can say, and it must not be shadowed by a stale environment.
  it('prefers the token passed in over the environment', () => {
    expect(
      panelHeaders({ PORTTA_TOKEN: 'ptt_env' }, 'a', undefined, {
        token: 'ptt_flag',
      }).authorization,
    ).toBe('Bearer ptt_flag')
  })

  // The agent talks to the panel. The panel talks to GitHub. Nothing about the
  // App ever reaches this process, and a header named for one would mean it had.
  it('carries nothing that could be a GitHub credential', () => {
    const headers = panelHeaders(
      {
        PORTTA_TOKEN: 'ptt_secret',
      },
      'agent',
    )
    const serialised = JSON.stringify(headers)
    expect(serialised).not.toContain('shhh')
    expect(serialised).not.toContain('app.pem')
    expect(serialised.toLowerCase()).not.toContain('github')
  })
})

describe('describeFailure', () => {
  // An agent needs to tell "you asked for something impossible" from "try
  // again later", or it retries the first and gives up on the second.
  it('says which kind of failure it was', () => {
    expect(describeFailure(400, 'nothing to change')).toMatch(/^refused:/)
    expect(describeFailure(403, 'read-only')).toMatch(/^not permitted:/)
    expect(describeFailure(404, 'no project')).toMatch(/^not found:/)
    expect(describeFailure(503, 'rate limit')).toMatch(/worth retrying/)
    expect(describeFailure(500, 'boom')).toContain('the panel answered 500')
  })
})

describe('the API caller', () => {
  it('prefixes /api and carries the headers', async () => {
    const fetchMock = vi.fn(async () => new Response('{"sessions":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const call = createCaller('http://127.0.0.1:8081', {
      'X-Portta-Actor': 'agent',
    })
    const result = await call('GET', '/projects/produto/sessions')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8081/api/projects/produto/sessions')
    expect((init.headers as Record<string, string>)['X-Portta-Actor']).toBe('agent')
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toBe('{"sessions":[]}')
    vi.unstubAllGlobals()
  })

  it('turns a failure into a readable tool error rather than throwing', async () => {
    vi.stubGlobal('fetch', async () => new Response('no project', { status: 404 }))
    const call = createCaller('http://127.0.0.1:8081', {})
    const result = await call('GET', '/projects/nope')
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/^not found:/)
    vi.unstubAllGlobals()
  })

  // A panel that is not running is the most common thing an agent will hit,
  // and it must read as a normal answer rather than as a crashed server.
  it('reports an unreachable panel as a tool error, naming the URL', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    const call = createCaller('http://127.0.0.1:8081', {})
    const result = await call('GET', '/projects/produto')
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('http://127.0.0.1:8081')
    expect(result.content[0]?.text).toContain('ECONNREFUSED')
    vi.unstubAllGlobals()
  })
})

describe('what portta mcp serves', () => {
  // The stdio list is the shared list with the host, plus every module's
  // tools. The panel's HTTP transport asserts the same identity minus the
  // host-only tools, so the two lists cannot drift apart unnoticed.
  it('is the shared list with the host, plus the modules', () => {
    const server = new McpServer({ name: 'test', version: '0' })
    registerCliTools(server, async () => ({ content: [] }), {
      resolvePath: async () => ({}),
      documentation: async () => ({}),
      documentationOrigin: 'local',
    })
    const names = Object.keys((server as any)._registeredTools as Record<string, unknown>)
    expect(names).toEqual([...sharedToolNames({ host: true }), ...TASKFLOW_TOOL_NAMES])
    expect(names).toContain('resolve_project')
  })
})
