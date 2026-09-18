// Taskflow's tools, on every transport.
//
// The same adapter as the panel tools: one tool, one call to the panel, which
// authorises the agent against the module's permissions and forwards the
// request 1:1 to the host daemon at `/api/modules/taskflow/…`. Nothing here
// talks to the daemon directly, so an agent never holds the host token. The
// CLI and the panel each register these through their module registry.

import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type ApiCaller, asSdkResult } from './tools.ts'

const segment = (value: string) => encodeURIComponent(value)

/** The panel path of a Project's Taskflow route: `/modules/taskflow/<prefix>/api/…`. */
function projectPath(project: string, path: string): string {
  return `/modules/taskflow/${segment(project)}/api${path}`
}

const PROJECT = z.string().min(1).describe('The Taskflow project prefix, as list_flow_projects answers it.')
const WORKTREE = z.string().min(1).describe('The worktree branch name.')
const RUN = z.string().min(1).describe('The Run id.')
const IDEMPOTENCY = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe('Repeat the same key to retry without starting twice. Generated when omitted.')
const INPUT = z.unknown().describe('The Run input: text, or a JSON value the workflow accepts.')
const WORKSPACE = z
  .enum(['isolated_worktree', 'new_branch', 'current_branch'])
  .optional()
  .describe('Where the Run works. Default: the workflow policy, or a new worktree.')

function workspace(strategy: string | undefined): Record<string, unknown> {
  return strategy === undefined ? {} : { workspace: { strategy } }
}

export function registerTaskflowTools(server: McpServer, call: ApiCaller): void {
  server.registerTool(
    'list_flow_projects',
    {
      title: 'Taskflow projects',
      description: 'The repositories the host daemon serves, with the prefix every other Taskflow tool takes.',
      inputSchema: {},
    },
    async () => asSdkResult(call('GET', '/modules/taskflow/api/projects')),
  )

  // --- worktrees
  server.registerTool(
    'list_worktrees',
    {
      title: 'Worktrees of a project',
      description: 'Each worktree with its branch, session, agent status, pull request and environment.',
      inputSchema: { project: PROJECT },
    },
    async ({ project }) => asSdkResult(call('GET', projectPath(project, '/worktrees'))),
  )

  server.registerTool(
    'create_worktree',
    {
      title: 'Create a worktree',
      description: 'A new Git worktree and its session, optionally launching an agent with a first prompt.',
      inputSchema: {
        project: PROJECT,
        branch: z.string().optional().describe('Generated from the prompt when omitted.'),
        baseBranch: z.string().optional(),
        profile: z.string().optional(),
        agent: z.string().optional().describe('The agent id to launch.'),
        prompt: z.string().optional(),
      },
    },
    async ({ project, ...body }) => asSdkResult(call('POST', projectPath(project, '/worktrees'), body)),
  )

  server.registerTool(
    'remove_worktree',
    {
      title: 'Remove a worktree',
      description: 'Closes its session and removes the worktree from disk. Uncommitted work in it is lost.',
      inputSchema: { project: PROJECT, worktree: WORKTREE },
    },
    async ({ project, worktree }) =>
      asSdkResult(call('DELETE', projectPath(project, `/worktrees/${segment(worktree)}`))),
  )

  server.registerTool(
    'send_to_worktree',
    {
      title: 'Send a prompt to a worktree agent',
      inputSchema: { project: PROJECT, worktree: WORKTREE, text: z.string().min(1), preamble: z.string().optional() },
    },
    async ({ project, worktree, ...body }) =>
      asSdkResult(call('POST', projectPath(project, `/worktrees/${segment(worktree)}/send`), body)),
  )

  // --- workflows and Runs
  server.registerTool(
    'list_workflows',
    {
      title: 'Workflows of a project',
      inputSchema: { project: PROJECT },
    },
    async ({ project }) => asSdkResult(call('GET', projectPath(project, `/projects/${segment(project)}/workflows`))),
  )

  server.registerTool(
    'run_workflow',
    {
      title: 'Start a Workflow Run',
      inputSchema: {
        project: PROJECT,
        workflow: z.string().min(1).describe('The workflow id.'),
        input: INPUT,
        profile: z.string().optional(),
        workspace: WORKSPACE,
        idempotencyKey: IDEMPOTENCY,
      },
    },
    async ({ project, workflow, input, profile, workspace: strategy, idempotencyKey }) =>
      asSdkResult(
        call('POST', projectPath(project, `/projects/${segment(project)}/runs`), {
          mode: 'workflow',
          workflowId: workflow,
          input: input ?? null,
          ...(profile ? { profile } : {}),
          ...workspace(strategy),
          idempotencyKey: idempotencyKey ?? randomUUID(),
        }),
      ),
  )

  server.registerTool(
    'start_direct_session',
    {
      title: 'Start a Direct Session',
      description: 'One agent harness working on the input, without a workflow around it.',
      inputSchema: {
        project: PROJECT,
        harness: z.string().min(1).describe('The agent harness, e.g. claude or codex.'),
        input: INPUT,
        provider: z.string().optional(),
        model: z.string().optional(),
        profile: z.string().optional(),
        workspace: WORKSPACE,
        idempotencyKey: IDEMPOTENCY,
      },
    },
    async ({ project, input, workspace: strategy, idempotencyKey, ...fields }) =>
      asSdkResult(
        call('POST', projectPath(project, `/projects/${segment(project)}/runs`), {
          mode: 'direct',
          input: input ?? null,
          ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
          ...workspace(strategy),
          idempotencyKey: idempotencyKey ?? randomUUID(),
        }),
      ),
  )

  server.registerTool(
    'list_runs',
    {
      title: 'Runs of a project',
      inputSchema: { project: PROJECT },
    },
    async ({ project }) => asSdkResult(call('GET', projectPath(project, `/projects/${segment(project)}/runs`))),
  )

  server.registerTool(
    'get_run',
    {
      title: 'One Run',
      description: 'Status, executions, pending permission requests and the result.',
      inputSchema: { project: PROJECT, run: RUN },
    },
    async ({ project, run }) => asSdkResult(call('GET', projectPath(project, `/runs/${segment(run)}`))),
  )

  server.registerTool(
    'cancel_run',
    {
      title: 'Cancel a Run',
      inputSchema: { project: PROJECT, run: RUN, idempotencyKey: IDEMPOTENCY },
    },
    async ({ project, run, idempotencyKey }) =>
      asSdkResult(
        call('POST', projectPath(project, `/runs/${segment(run)}/cancel`), {
          idempotencyKey: idempotencyKey ?? randomUUID(),
        }),
      ),
  )

  server.registerTool(
    'resume_run',
    {
      title: 'Resume a Run',
      inputSchema: { project: PROJECT, run: RUN, idempotencyKey: IDEMPOTENCY },
    },
    async ({ project, run, idempotencyKey }) =>
      asSdkResult(
        call('POST', projectPath(project, `/runs/${segment(run)}/resume`), {
          idempotencyKey: idempotencyKey ?? randomUUID(),
        }),
      ),
  )

  server.registerTool(
    'respond_permission',
    {
      title: 'Answer a Run permission request',
      description: 'Choose one of the options the agent offered, or deny with a null option.',
      inputSchema: { project: PROJECT, run: RUN, requestId: z.uuid(), optionId: z.string().min(1).nullable() },
    },
    async ({ project, run, ...body }) =>
      asSdkResult(call('POST', projectPath(project, `/runs/${segment(run)}/permission`), body)),
  )

  server.registerTool(
    'get_transcript',
    {
      title: 'Transcript of an execution',
      description: 'The structured messages, tool calls and results of one execution of a Run.',
      inputSchema: {
        project: PROJECT,
        execution: z.string().min(1),
        after: z.number().int().min(0).optional().describe('Only entries after this sequence number.'),
      },
    },
    async ({ project, execution, after }) =>
      asSdkResult(
        call(
          'GET',
          projectPath(
            project,
            `/executions/${segment(execution)}/transcript${after === undefined ? '' : `?after=${after}`}`,
          ),
        ),
      ),
  )

  // --- environments
  server.registerTool(
    'list_environment_services',
    {
      title: 'Services of a worktree or Run environment',
      inputSchema: {
        project: PROJECT,
        environment: z.string().min(1).describe('The environment id, from list_worktrees or get_run.'),
      },
    },
    async ({ project, environment }) =>
      asSdkResult(call('GET', projectPath(project, `/environments/${segment(environment)}/services`))),
  )

  server.registerTool(
    'expose_endpoint',
    {
      title: 'Expose an environment service',
      description: 'A private endpoint for one service, reachable by whoever can reach the panel.',
      inputSchema: { project: PROJECT, environment: z.string().min(1), service: z.string().min(1) },
    },
    async ({ project, environment, service }) =>
      asSdkResult(
        call(
          'POST',
          projectPath(project, `/environments/${segment(environment)}/services/${segment(service)}/expose`),
          { visibility: 'private' },
        ),
      ),
  )
}

/** The tool names, in the order they are registered. Asserted by a test. */
export const TASKFLOW_TOOL_NAMES = [
  'list_flow_projects',
  'list_worktrees',
  'create_worktree',
  'remove_worktree',
  'send_to_worktree',
  'list_workflows',
  'run_workflow',
  'start_direct_session',
  'list_runs',
  'get_run',
  'cancel_run',
  'resume_run',
  'respond_permission',
  'get_transcript',
  'list_environment_services',
  'expose_endpoint',
] as const
