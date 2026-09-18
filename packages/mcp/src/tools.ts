// The panel's verbs as MCP tools.
//
// A thin adapter and nothing more. Every tool is one call to one endpoint; no
// tool composes two, because a workflow that needs composing composes in the
// API, where it can be tested without a transport. If a tool here ever grows a
// second request, that is the signal to add a verb to the API instead.
//
// Registered once, served twice: `portta mcp` speaks these over stdio, and the
// panel serves the same list over Streamable HTTP (ADR 0054). What differs is
// the `ApiCaller` each transport hands in, and whether a `PathResolver` exists.
//
// **The agent never holds a GitHub credential.** Issues are read and written by
// the host daemon, through the `gh` session or the Linear key already on the
// host. An agent holds a panel URL and, when the panel is authenticated, a
// panel credential.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'portta-core/zod'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * The shape every tool answers with. Widened to the SDK's own result type at
 * the registration boundary rather than in every handler, so the handlers stay
 * readable and one cast carries the whole adapter.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

type SdkToolResult = Awaited<ReturnType<Parameters<McpServer['registerTool']>[2]>>
export const asSdkResult = (result: Promise<ToolResult>) => result as Promise<SdkToolResult>

/** One request to the panel API, answered as a tool result. A refusal is a result, never a throw. */
export type ApiCaller = (method: HttpMethod, path: string, body?: unknown) => Promise<ToolResult>

/**
 * How a panel answer becomes a sentence.
 *
 * A caller needs to tell "you asked for something impossible" from "try again
 * later", so the status codes are carried through as words rather than
 * flattened into one failure. 503 is temporary by construction: it is what a
 * GitHub outage, a stopped database or an exhausted rate limit looks like.
 */
export function describeFailure(status: number, body: string): string {
  const detail = extractMessage(body)
  if (status === 400) return `refused: ${detail}`
  if (status === 401 || status === 403) return `not permitted: ${detail}`
  if (status === 404) return `not found: ${detail}`
  if (status === 503) return `temporarily unavailable, and worth retrying: ${detail}`
  return `the panel answered ${status}: ${detail}`
}

function extractMessage(body: string): string {
  const trimmed = body.trim()
  if (trimmed === '') return '(no detail)'
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown; hint?: unknown }
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.error === 'object' &&
            parsed.error &&
            'message' in parsed.error &&
            typeof (parsed.error as { message?: unknown }).message === 'string'
          ? (parsed.error as { message: string }).message
          : typeof parsed.message === 'string'
            ? parsed.message
            : null
    if (message) return typeof parsed.hint === 'string' ? `${message} (${parsed.hint})` : message
  } catch {
    // not JSON: the body is the message
  }
  return trimmed
}

/** A slug, an id or a compose project name all have to survive a path segment. */
function ref(value: string): string {
  return encodeURIComponent(value)
}

function search(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') query.set(key, String(value))
  const text = query.toString()
  return text === '' ? '' : `?${text}`
}

const ISSUE = z
  .string()
  .min(1)
  .describe('An issue ref: `github:owner/repo#113` or `linear:ENG-42`. A bare number or `ENG-42` is accepted too.')

/**
 * The provider's own key from whatever an agent sent.
 *
 * The routes take the key, and an agent that read a ref out of a session or an
 * activity row has the whole thing. Narrowing here rather than refusing keeps
 * both spellings working, which is what an agent copying a value between tools
 * actually does.
 */
function issueKey(raw: string): string {
  const value = raw.trim()
  const separator = value.indexOf(':')
  const key = separator > 0 ? value.slice(separator + 1) : value
  const hash = key.lastIndexOf('#')
  return (hash >= 0 ? key.slice(hash + 1) : key).trim()
}
const PROJECT = z.string().min(1).describe('The Project slug.')

/**
 * Resolves a host directory to its Project. Only a process on the host can
 * provide one: the CLI's resolver reads the working tree and then asks the
 * panel. A transport with no resolver serves no `resolve_project`.
 */
export type PathResolver = (path: string) => Promise<unknown>

/**
 * One tool per endpoint, named for what an agent asks. Registered here so the
 * list can be asserted without starting a transport.
 */
export function registerPanelTools(server: McpServer, call: ApiCaller, resolvePath?: PathResolver): void {
  if (resolvePath) {
    server.registerTool(
      'resolve_project',
      {
        title: 'Which Project a directory belongs to',
        description:
          'Resolve an absolute path on this host to its Project and repository: the repository root, a subdirectory of it, or a linked worktree. Fails explicitly (unknown, ambiguous, stale, unauthorized) instead of guessing.',
        inputSchema: { path: z.string().min(1).describe('An absolute directory path on this host.') },
      },
      async ({ path }) => {
        try {
          const outcome = await resolvePath(path)
          return { content: [{ type: 'text', text: JSON.stringify(outcome, null, 2) }] }
        } catch (error) {
          return {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          }
        }
      },
    )
  }

  // --- read: projects, repositories, environments, services, logs, resources
  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      description: 'Every Project on this Node with its repositories, environments and health, in one answer.',
      inputSchema: {},
    },
    async () => asSdkResult(call('GET', '/projects')),
  )

  server.registerTool(
    'get_project',
    {
      title: 'Get one Project',
      description: 'Repositories with their git state, environments with their services, and the counts that matter.',
      inputSchema: { project: PROJECT },
    },
    async ({ project }) => asSdkResult(call('GET', `/projects/${ref(project)}`)),
  )

  server.registerTool(
    'get_context',
    {
      title: 'The Development Context of a Project',
      description:
        'What to read before working: the Project, its repositories with their branches and worktrees, the issue (when given), the environments and how to reach them, the instruction files that apply, and the diagnostics that say what needs doing first. The body names its own schema and version.',
      inputSchema: { project: PROJECT, issue: ISSUE.optional() },
    },
    async ({ project, issue }) => asSdkResult(call('GET', `/projects/${ref(project)}/context${search({ issue })}`)),
  )

  server.registerTool(
    'list_repositories',
    {
      title: "A Project's repositories",
      inputSchema: { project: PROJECT },
    },
    async ({ project }) => asSdkResult(call('GET', `/projects/${ref(project)}/repositories`)),
  )

  server.registerTool(
    'get_repository_git',
    {
      title: 'Git state of a repository',
      description:
        'Branch, HEAD, dirty counts, ahead/behind, the last commits and the instruction files, as the host collected them.',
      inputSchema: { repository: z.string().min(1).describe('The repository id.') },
    },
    async ({ repository }) => asSdkResult(call('GET', `/repositories/${ref(repository)}/git`)),
  )

  server.registerTool(
    'list_specifications',
    {
      title: 'The decision records and specification documents of a repository',
      description:
        'ADRs under docs/**/adr, an openspec/ tree and a Spec Kit tree, as references the host scan recognised: path, convention (adr, openspec, spec-kit), kind, title, hash and whether the working tree differs from HEAD. References only, never content; a repository without any answers an empty list.',
      inputSchema: { repository: z.string().min(1).describe('The repository id.') },
    },
    async ({ repository }) => asSdkResult(call('GET', `/repositories/${ref(repository)}/specifications`)),
  )

  server.registerTool(
    'list_environments',
    {
      title: 'Environments running on this Node',
      inputSchema: { all: z.boolean().optional().describe('Include environments with nothing on the gateway.') },
    },
    async ({ all }) => asSdkResult(call('GET', `/environments${search({ all })}`)),
  )

  server.registerTool(
    'get_environment',
    {
      title: 'One environment',
      description: 'Its services, URLs, health, the issue it runs for, and whether it can be operated.',
      inputSchema: { environment: z.string().min(1).describe('COMPOSE_PROJECT_NAME') },
    },
    async ({ environment }) => asSdkResult(call('GET', `/environments/${ref(environment)}`)),
  )

  server.registerTool(
    'list_services',
    {
      title: "An environment's services",
      description: 'State, health, endpoints, resources and container per service.',
      inputSchema: { environment: z.string().min(1) },
    },
    async ({ environment }) => asSdkResult(call('GET', `/environments/${ref(environment)}/services`)),
  )

  server.registerTool(
    'get_logs',
    {
      title: 'Logs of an environment, or of one service in it',
      inputSchema: {
        environment: z.string().min(1),
        service: z.string().optional(),
        tail: z.number().int().min(1).max(2000).optional(),
      },
    },
    async ({ environment, service, tail }) =>
      asSdkResult(call('GET', `/environments/${ref(environment)}/logs${search({ service, tail })}`)),
  )

  server.registerTool(
    'get_resources',
    {
      title: 'Host resources, by Project',
      description: 'CPU, memory and storage of this machine, and which Project consumes what.',
      inputSchema: { project: PROJECT.optional() },
    },
    async ({ project }) =>
      asSdkResult(call('GET', project ? `/projects/${ref(project)}/resources` : '/metrics/current')),
  )

  server.registerTool(
    'list_activity',
    {
      title: 'What happened',
      description: 'Sessions started and ended, commits landed, environments started and stopped. Newest first.',
      inputSchema: {
        project: PROJECT.optional(),
        kind: z.string().optional().describe('Comma-separated event kinds.'),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ project, kind, limit }) =>
      asSdkResult(
        call('GET', `${project ? `/projects/${ref(project)}/activity` : '/activity'}${search({ kind, limit })}`),
      ),
  )

  // --- issues
  // Scoped to a Project, like the API: an agent names the Project it is working
  // in, and the Project decides which repository or Linear team that is
  // (ADR 0050). There is no verb that takes a repository, deliberately — an
  // agent that could name one could write to a repository nobody linked.
  server.registerTool(
    'list_issues',
    {
      title: "A Project's issues",
      description:
        'Read live from GitHub or Linear. Nothing is mirrored, so this can fail when the provider is unreachable; the error says which of gh, the host daemon or the provider is missing.',
      inputSchema: {
        project: PROJECT,
        state: z.enum(['open', 'closed', 'all']).optional().describe('Defaults to open.'),
        assignee: z.string().optional().describe('Provider login. GitHub only.'),
        label: z.string().optional(),
        q: z.string().optional().describe("Free text, passed to the provider's own search. GitHub only."),
      },
    },
    async ({ project, ...filters }) => asSdkResult(call('GET', `/projects/${ref(project)}/issues${search(filters)}`)),
  )

  server.registerTool(
    'get_issue',
    {
      title: 'One issue, in full',
      description:
        'Body, comments, labels, assignees, and the environments Portta knows are running for it — which is the part no provider can tell you.',
      inputSchema: { project: PROJECT, issue: ISSUE },
    },
    async ({ project, issue }) => asSdkResult(call('GET', `/projects/${ref(project)}/issues/${ref(issueKey(issue))}`)),
  )

  server.registerTool(
    'create_issue',
    {
      title: 'Open an issue',
      description: "Opens it where the Project's work lives, as whoever is signed in on the host.",
      inputSchema: {
        project: PROJECT,
        title: z.string().min(1),
        body: z.string().optional().describe('Markdown.'),
        labels: z.array(z.string()).optional(),
        assignees: z.array(z.string()).optional(),
      },
    },
    async ({ project, ...body }) => asSdkResult(call('POST', `/projects/${ref(project)}/issues`, body)),
  )

  server.registerTool(
    'update_issue',
    {
      title: 'Change an issue',
      description:
        'Title, body, state, labels and assignees. Labels and assignees are added and removed rather than replaced, so two writers merge instead of clobbering.',
      inputSchema: {
        project: PROJECT,
        issue: ISSUE,
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(['open', 'closed']).optional(),
        stateReason: z.enum(['completed', 'not planned']).optional(),
        addLabels: z.array(z.string()).optional(),
        removeLabels: z.array(z.string()).optional(),
        addAssignees: z.array(z.string()).optional(),
        removeAssignees: z.array(z.string()).optional(),
      },
    },
    async ({ project, issue, ...body }) =>
      asSdkResult(call('PATCH', `/projects/${ref(project)}/issues/${ref(issueKey(issue))}`, body)),
  )

  server.registerTool(
    'comment_on_issue',
    {
      title: 'Comment on an issue',
      description:
        'Posted as whoever is signed in on the host, so it is attributable to a person rather than to a bot.',
      inputSchema: { project: PROJECT, issue: ISSUE, body: z.string().min(1).describe('Markdown.') },
    },
    async ({ project, issue, body }) =>
      asSdkResult(call('POST', `/projects/${ref(project)}/issues/${ref(issueKey(issue))}/comments`, { body })),
  )

  // --- sessions
  server.registerTool(
    'start_session',
    {
      title: 'Say that you are working',
      description:
        'Start a development session on a Project, optionally on an issue, a repository and an environment. End it with end_session.',
      inputSchema: {
        project: PROJECT,
        issueRef: ISSUE.optional(),
        repositoryId: z.string().optional(),
        environment: z.string().optional(),
        summary: z.string().optional(),
      },
    },
    async ({ project, ...body }) => asSdkResult(call('POST', `/projects/${ref(project)}/sessions`, body)),
  )

  server.registerTool(
    'end_session',
    {
      title: 'Say that you are done',
      inputSchema: { session: z.string().min(1), summary: z.string().optional() },
    },
    async ({ session, summary }) =>
      asSdkResult(
        call('PATCH', `/sessions/${ref(session)}`, { status: 'ended', ...(summary === undefined ? {} : { summary }) }),
      ),
  )

  // --- operate (gated by capability on the panel, not here)
  server.registerTool(
    'start_environment',
    {
      title: 'Start an environment',
      inputSchema: { environment: z.string().min(1) },
    },
    async ({ environment }) => asSdkResult(call('POST', `/environments/${ref(environment)}/actions/start`)),
  )

  server.registerTool(
    'stop_environment',
    {
      title: 'Stop an environment',
      inputSchema: { environment: z.string().min(1) },
    },
    async ({ environment }) => asSdkResult(call('POST', `/environments/${ref(environment)}/actions/stop`)),
  )

  server.registerTool(
    'restart_service',
    {
      title: 'Restart one service of an environment',
      inputSchema: { environment: z.string().min(1), service: z.string().min(1) },
    },
    async ({ environment, service }) =>
      asSdkResult(call('POST', `/environments/${ref(environment)}/services/${ref(service)}/actions/restart`)),
  )
}

/** The tool names, in the order they are registered. Asserted by a test. */
export const PANEL_TOOL_NAMES = [
  'resolve_project',
  'list_projects',
  'get_project',
  'get_context',
  'list_repositories',
  'get_repository_git',
  'list_specifications',
  'list_environments',
  'get_environment',
  'list_services',
  'get_logs',
  'get_resources',
  'list_activity',
  'list_issues',
  'get_issue',
  'create_issue',
  'update_issue',
  'comment_on_issue',
  'start_session',
  'end_session',
  'start_environment',
  'stop_environment',
  'restart_service',
] as const

/**
 * The tools only a process on the host can serve. `portta mcp` registers them
 * because it runs where the working tree is; the panel's HTTP transport does
 * not, and says so in its list rather than answering with a guess.
 */
export const HOST_ONLY_TOOL_NAMES = ['resolve_project'] as const
