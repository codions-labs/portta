import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { registerTaskflowTools, TASKFLOW_TOOL_NAMES } from './taskflow-tools.ts'

type Tools = Record<string, { handler: (args: unknown) => Promise<unknown> }>

function harness() {
  const calls: Array<[string, string, unknown]> = []
  const server = new McpServer({ name: 'test', version: '0' })
  registerTaskflowTools(server, async (method, path, body) => {
    calls.push([method, path, body])
    return { content: [{ type: 'text', text: '{}' }] }
  })
  const tools = (server as unknown as { _registeredTools: Tools })._registeredTools
  return { tools, calls }
}

const project = 'shop'
const ARGS: Record<(typeof TASKFLOW_TOOL_NAMES)[number], Record<string, unknown>> = {
  list_flow_projects: {},
  list_worktrees: { project },
  create_worktree: { project, branch: 'feature/search', prompt: 'Add search' },
  remove_worktree: { project, worktree: 'feature/search' },
  send_to_worktree: { project, worktree: 'feature/search', text: 'Continue' },
  list_workflows: { project },
  run_workflow: { project, workflow: 'code-review', input: { target: 'main' }, idempotencyKey: 'k1' },
  start_direct_session: { project, harness: 'claude', input: 'Fix the flaky test', idempotencyKey: 'k2' },
  list_runs: { project },
  get_run: { project, run: 'run_1' },
  cancel_run: { project, run: 'run_1', idempotencyKey: 'k3' },
  resume_run: { project, run: 'run_1', idempotencyKey: 'k4' },
  respond_permission: { project, run: 'run_1', requestId: '6f1c1f5e-3a0a-4c38-9a53-2b8f1b1c9d11', optionId: null },
  get_transcript: { project, execution: 'exec_1', after: 3 },
  list_environment_services: { project, environment: 'env_1' },
  expose_endpoint: { project, environment: 'env_1', service: 'api' },
}

describe('the Taskflow MCP tools', () => {
  it('registers every tool, each making exactly one panel call under /modules/taskflow', async () => {
    const { tools, calls } = harness()
    expect(Object.keys(tools)).toEqual([...TASKFLOW_TOOL_NAMES])
    for (const name of TASKFLOW_TOOL_NAMES) {
      calls.length = 0
      await tools[name]?.handler(ARGS[name])
      expect(calls, name).toHaveLength(1)
      expect(calls[0]?.[1], name).toMatch(/^\/modules\/taskflow\//)
    }
  })

  it('reaches the routes the host serves, with a worktree name kept as one segment', async () => {
    const { tools, calls } = harness()
    const run = async (name: (typeof TASKFLOW_TOOL_NAMES)[number]) => {
      calls.length = 0
      await tools[name]?.handler(ARGS[name])
      return calls[0]
    }
    expect(await run('list_flow_projects')).toEqual(['GET', '/modules/taskflow/api/projects', undefined])
    expect(await run('remove_worktree')).toEqual([
      'DELETE',
      '/modules/taskflow/shop/api/worktrees/feature%2Fsearch',
      undefined,
    ])
    expect(await run('run_workflow')).toEqual([
      'POST',
      '/modules/taskflow/shop/api/projects/shop/runs',
      { mode: 'workflow', workflowId: 'code-review', input: { target: 'main' }, idempotencyKey: 'k1' },
    ])
    expect(await run('start_direct_session')).toEqual([
      'POST',
      '/modules/taskflow/shop/api/projects/shop/runs',
      { mode: 'direct', harness: 'claude', input: 'Fix the flaky test', idempotencyKey: 'k2' },
    ])
    expect(await run('get_transcript')).toEqual([
      'GET',
      '/modules/taskflow/shop/api/executions/exec_1/transcript?after=3',
      undefined,
    ])
    expect(await run('expose_endpoint')).toEqual([
      'POST',
      '/modules/taskflow/shop/api/environments/env_1/services/api/expose',
      { visibility: 'private' },
    ])
  })

  it('generates an idempotency key when the agent gives none', async () => {
    const { tools, calls } = harness()
    await tools.cancel_run?.handler({ project, run: 'run_1' })
    expect(calls[0]?.[2]).toEqual({ idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  })
})
