import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import {
  HOST_ONLY_TOOL_NAMES,
  PANEL_TOOL_NAMES,
  registerPanelTools,
  registerSharedTools,
  sharedToolNames,
} from './index.ts'

type Tools = Record<string, { handler: (args: unknown) => Promise<unknown> }>
const registered = (server: McpServer) =>
  Object.keys((server as unknown as { _registeredTools: Tools })._registeredTools)
const noCall = async () => ({ content: [{ type: 'text' as const, text: '{}' }] })
const noDocs = async () => ({})

describe('what each transport serves', () => {
  // The one tool that reads the host is the one the panel cannot serve, and the
  // list a transport announces must be the list it registers.
  it('registers resolve_project only when a resolver exists, and the names say so', () => {
    const host = new McpServer({ name: 'test', version: '0' })
    registerSharedTools(host, noCall, {
      resolvePath: async () => ({}),
      documentation: noDocs,
      documentationOrigin: 'local',
    })
    expect(registered(host)).toEqual(sharedToolNames({ host: true }))

    const panel = new McpServer({ name: 'test', version: '0' })
    registerSharedTools(panel, noCall, { documentation: noDocs, documentationOrigin: 'panel' })
    expect(registered(panel)).toEqual(sharedToolNames({ host: false }))
    expect(registered(panel)).not.toContain('resolve_project')
    expect(sharedToolNames({ host: true }).filter((name) => !sharedToolNames({ host: false }).includes(name))).toEqual([
      ...HOST_ONLY_TOOL_NAMES,
    ])
  })
})

describe('the tools', () => {
  function harness() {
    const calls: Array<[string, string, unknown]> = []
    const resolved: string[] = []
    const server = new McpServer({ name: 'test', version: '0' })
    registerPanelTools(
      server,
      async (method, path, body) => {
        calls.push([method, path, body])
        return { content: [{ type: 'text', text: '{}' }] }
      },
      async (path) => {
        resolved.push(path)
        return { resolved: true, path }
      },
    )
    return { server, calls, resolved }
  }

  // A tool that composes two calls is a workflow, and a workflow belongs in the
  // API where it can be tested without a transport.
  it('makes exactly one API call per tool', async () => {
    const { server, calls, resolved } = harness()
    const tools = (server as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<unknown> }>
    const args: Record<string, unknown> = {
      resolve_project: { path: '/srv/projects/produto' },
      list_projects: {},
      get_project: { project: 'produto' },
      get_context: { project: 'produto', issue: 'github:acme/api#7' },
      list_repositories: { project: 'produto' },
      get_repository_git: { repository: '10' },
      list_specifications: { repository: '10' },
      list_environments: { all: true },
      get_environment: { environment: 'alpha' },
      list_services: { environment: 'alpha' },
      get_logs: { environment: 'alpha', service: 'api', tail: 50 },
      get_resources: { project: 'produto' },
      list_activity: { project: 'produto' },
      list_issues: { project: 'produto', state: 'open' },
      get_issue: { project: 'produto', issue: 'github:acme/api#7' },
      create_issue: { project: 'produto', title: 'Fix the checkout' },
      update_issue: { project: 'produto', issue: 'github:acme/api#7', state: 'closed' },
      comment_on_issue: { project: 'produto', issue: 'github:acme/api#7', body: 'Done.' },
      start_session: { project: 'produto', issueRef: 'github:acme/api#1' },
      end_session: { session: '9' },
      start_environment: { environment: 'alpha' },
      stop_environment: { environment: 'alpha' },
      restart_service: { environment: 'alpha', service: 'api' },
    }
    for (const name of PANEL_TOOL_NAMES) {
      calls.length = 0
      resolved.length = 0
      const tool = tools[name]
      if (!tool) throw new Error(`missing registered tool: ${name}`)
      await tool.handler(args[name])
      // Resolution reads the host, then the registry through the CLI's own
      // resolver; it is the one tool that is not a single API call.
      if (name === 'resolve_project') {
        expect(calls, name).toHaveLength(0)
        expect(resolved, name).toEqual(['/srv/projects/produto'])
        continue
      }
      expect(calls, name).toHaveLength(1)
    }
  })

  // An issue ref carries `#`, which would otherwise truncate the URL at the
  // fragment and send the panel a query it never meant to answer.
  it('encodes an issue ref into the query string', async () => {
    const { server, calls } = harness()
    const tools = (server as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<unknown> }>
    const getContext = tools.get_context
    if (!getContext) throw new Error('missing registered get_context tool')
    await getContext.handler({ project: 'produto', issue: 'github:acme/api#42' })
    expect(calls[0]?.[1]).toBe('/projects/produto/context?issue=github%3Aacme%2Fapi%2342')
    expect(calls[0]?.[1]).not.toContain('#')
  })

  it('omits an optional field rather than guessing at it', async () => {
    const { server, calls } = harness()
    const tools = (server as any)._registeredTools as Record<string, { handler: (args: unknown) => Promise<unknown> }>
    const endSession = tools.end_session
    if (!endSession) throw new Error('missing registered end_session tool')
    await endSession.handler({ session: '9' })
    expect(calls[0]?.[2]).toEqual({ status: 'ended' })
    await endSession.handler({ session: '9', summary: 'done' })
    expect(calls[1]?.[2]).toEqual({ status: 'ended', summary: 'done' })
  })
})
