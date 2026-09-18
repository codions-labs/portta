// A host daemon that knows one Taskflow Project, for the module's end-to-end
// smoke: the panel proxies to it exactly as it would to `portta host serve`,
// token and all, and it answers with a small, fixed Project.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'

export const TASKFLOW_PROJECT = { prefix: 'shop', name: 'shop', path: '/srv/e2e/shop' }

const NOW = '2026-09-15T12:00:00.000Z'

const worktree = (branch, overrides = {}) => ({
  branch,
  label: null,
  path: `${TASKFLOW_PROJECT.path}/.portta/worktrees/${branch}`,
  dir: `${TASKFLOW_PROJECT.path}/.portta/worktrees/${branch}`,
  archived: false,
  profile: 'default',
  agentName: 'claude',
  agentLabel: 'Claude',
  agentTerminalStale: false,
  mux: false,
  dirty: false,
  unpushed: false,
  paneCount: 1,
  status: 'idle',
  elapsed: '3m',
  services: [],
  prs: [],
  linearIssue: null,
  creation: null,
  source: 'ui',
  oneshot: null,
  tabs: [],
  activeTabId: null,
  environmentId: null,
  interfaceMode: 'terminal',
  ...overrides,
})

const WORKTREES = [
  worktree('feature/login', { mux: true, status: 'running', dirty: true }),
  worktree('fix/checkout', { label: 'Checkout total' }),
]

const CONFIG = {
  name: 'shop',
  multiplexer: 'tmux',
  services: [],
  profiles: [{ name: 'default' }],
  agents: [
    {
      id: 'claude',
      label: 'Claude',
      kind: 'builtin',
      capabilities: { terminal: true, inAppChat: true, conversationHistory: true, interrupt: true, resume: true },
    },
  ],
  defaultProfileName: 'default',
  defaultAgentId: 'claude',
  autoName: false,
  linearCreateTicketOption: false,
  startupEnvs: {},
  linkedRepos: [],
  linearAutoCreateWorktrees: false,
  autoRemoveOnMerge: false,
  projectDir: TASKFLOW_PROJECT.path,
  mainBranch: 'main',
  build: { version: '0.1.0', builtAt: NOW },
}

const WORKFLOW = {
  id: 'builtin:code-review',
  name: 'code-review',
  description: 'Review the branch against its base and report findings.',
  origin: 'builtin',
  path: '/builtin/code-review.workflow.js',
  contentHash: 'e2e',
  phases: [{ key: '1', label: 'Review' }],
  availability: 'available',
  diagnostics: [],
  workspace: { default: 'isolated_worktree', allowed: ['isolated_worktree'], mutatesRepository: false },
}

const RUN = {
  id: 'run_e2e',
  projectId: TASKFLOW_PROJECT.prefix,
  mode: 'direct',
  input: 'Tighten the login form validation',
  status: 'running',
  workspacePolicy: 'run',
  workspaceStrategy: 'isolated_worktree',
  workflowSnapshot: null,
  harness: 'claude',
  workspace: {
    id: 'workspace_e2e',
    strategy: 'isolated_worktree',
    path: '/srv/e2e/run',
    branch: 'taskflow/login-validation',
    baseBranch: 'main',
    baseCommit: 'abc1234',
    state: 'ready',
  },
  profile: 'default',
  error: null,
  capabilities: { cancel: true, resume: false },
  createdAt: NOW,
  updatedAt: NOW,
  startedAt: NOW,
  completedAt: null,
  executions: [],
  result: null,
  workflowProgress: null,
  artifacts: [],
}

/** What the fake daemon answers for a route, or null for a 404. */
function answer(method, path) {
  if (method === 'GET' && path === '/api/modules/taskflow/api/projects')
    return { projects: [{ ...TASKFLOW_PROJECT, active: false }] }
  const project = `/api/modules/taskflow/${TASKFLOW_PROJECT.prefix}`
  if (method !== 'GET' || !path.startsWith(`${project}/`)) return null
  const routes = {
    '/api/config': CONFIG,
    '/api/worktrees': { worktrees: WORKTREES },
    '/api/linear/issues': { availability: 'disabled', issues: [] },
    '/api/project': { project: { name: 'shop', mainBranch: 'main' }, worktrees: WORKTREES, notifications: [] },
    [`/api/projects/${TASKFLOW_PROJECT.prefix}/workflows`]: { workflows: [WORKFLOW] },
    [`/api/projects/${TASKFLOW_PROJECT.prefix}/runs`]: { runs: [RUN] },
    [`/api/runs/${RUN.id}`]: { run: RUN },
    [`/api/runs/${RUN.id}/events`]: { events: [], nextCursor: null },
    '/api/agents': { agents: [] },
  }
  return routes[path.slice(project.length)] ?? null
}

/** Starts the daemon and writes the token the panel reads; `requests` records what reached it. */
export async function startTaskflowHost() {
  const token = 'an-end-to-end-host-token'
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'portta-e2e-host-')), 'token')
  writeFileSync(tokenFile, token)
  const requests = []
  const sockets = new WebSocketServer({ noServer: true })

  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end()
      return
    }
    const { pathname } = new URL(request.url ?? '/', 'http://host')
    requests.push(`${request.method} ${pathname}`)
    if (pathname.endsWith('/stream')) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write(': held open\n\n')
      return
    }
    const body = answer(request.method, pathname)
    response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body ?? { error: `the fake host has no ${request.method} ${pathname}` }))
  })

  server.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      requests.push(`WS ${new URL(request.url ?? '/', 'http://host').pathname}`)
      // The terminal protocol: `o` and the bytes a pane printed.
      ws.send('ofake host: attached to feature/login\r\n$ ')
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    tokenFile,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const client of sockets.clients) client.terminate()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
