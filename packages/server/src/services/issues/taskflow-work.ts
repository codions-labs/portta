// What Taskflow knows about an issue: worktrees, Runs and PRs, plus the
// gesture that starts a Run from the issue page.
//
// The daemon is asked with the panel's own token. A daemon that does not
// answer is "no Taskflow work", not an error: the issue still reads.

import { randomUUID } from 'node:crypto'
import type { IssueRunContext, IssueWorktreeLink } from 'portta-contracts'
import { BRANCH_TYPES, isBranchType, PROJECT_CONFIG_DEFAULTS, proposedIssueBranch } from 'portta-core'
import type { Database } from '../../db/index.ts'
import type { AppDeps } from '../../deps.ts'
import { readHostToken } from '../../modules/proxy.ts'
import { fetchTaskflowProjects, projectHostPaths, servesPath } from '../../modules/taskflow/scope.ts'
import { resolvedPathOf } from '../catalog.ts'

interface HostWorktree {
  path?: unknown
  branch?: unknown
  archived?: unknown
  issueRef?: unknown
  prs?: unknown
}

interface HostRun {
  id?: unknown
  status?: unknown
  issueRef?: unknown
  workspace?: { branch?: unknown } | null
}

interface HostConfig {
  branchPattern?: unknown
  agents?: unknown
  defaultAgentId?: unknown
}

async function hostJson(
  config: AppDeps['config'],
  path: string,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<unknown | null> {
  const token = readHostToken(config.hostTokenFile)
  if (!config.hostUrl || !token) return null
  let response: Response
  try {
    response = await fetch(`${config.hostUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  return response.json().catch(() => null)
}

export async function taskflowPrefixFor(
  deps: Pick<AppDeps, 'config' | 'db'>,
  db: Database,
  projectId: string,
): Promise<{ prefix: string; path: string } | null> {
  const project = await db.projects.findById(projectId)
  if (!project) return null
  const repositories = await db.repositories.list(project.id)
  const hostPaths = projectHostPaths(resolvedPathOf(deps.config.projectsHome, project.relativePath), repositories)
  const directories = await fetchTaskflowProjects(deps.config).catch(() => [])
  return directories.find((directory) => servesPath(hostPaths, directory.path)) ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Pair worktrees and Runs the daemon already answered, by the shared ref. */
export function projectWorktreesForIssue(issueRef: string, worktrees: unknown, runs: unknown): IssueWorktreeLink[] {
  const runByRef = new Map<string, { id: string; status: string; branch: string | null }>()
  if (Array.isArray(runs)) {
    for (const entry of runs as HostRun[]) {
      const ref = stringOf(entry.issueRef)
      const id = stringOf(entry.id)
      const status = stringOf(entry.status)
      if (!ref || !id || !status) continue
      if (!runByRef.has(ref)) {
        runByRef.set(ref, { id, status, branch: stringOf(entry.workspace?.branch) })
      }
    }
  }
  const fallback = (): IssueWorktreeLink[] => {
    const run = runByRef.get(issueRef)
    return run
      ? [
          {
            branch: run.branch ?? '',
            path: '',
            runId: run.id,
            runStatus: run.status,
            pullRequestUrl: null,
            pullRequestState: null,
          },
        ]
      : []
  }
  if (!Array.isArray(worktrees)) return fallback()
  const linked = (worktrees as HostWorktree[]).flatMap((entry): IssueWorktreeLink[] => {
    if (entry.archived === true) return []
    const branch = stringOf(entry.branch)
    const path = stringOf(entry.path)
    if (!branch || !path) return []
    if (stringOf(entry.issueRef) !== issueRef) return []
    const prs = Array.isArray(entry.prs) ? entry.prs : []
    const pr = prs.map((item) => asRecord(item)).find((item) => item !== null)
    const run = runByRef.get(issueRef)
    return [
      {
        branch,
        path,
        runId: run?.id ?? null,
        runStatus: run?.status ?? null,
        pullRequestUrl: stringOf(pr?.url),
        pullRequestState: stringOf(pr?.state),
      },
    ]
  })
  return linked.length > 0 ? linked : fallback()
}

export async function worktreesForIssue(
  deps: Pick<AppDeps, 'config' | 'db'>,
  db: Database,
  projectId: string,
  issueRef: string,
): Promise<IssueWorktreeLink[]> {
  const bound = await taskflowPrefixFor(deps, db, projectId)
  if (!bound) return []
  const prefix = encodeURIComponent(bound.prefix)
  const [worktreesBody, runsBody] = await Promise.all([
    hostJson(deps.config, `/api/modules/taskflow/${prefix}/api/worktrees`),
    hostJson(deps.config, `/api/modules/taskflow/${prefix}/api/projects/${prefix}/runs`),
  ])
  return projectWorktreesForIssue(issueRef, asRecord(worktreesBody)?.worktrees, asRecord(runsBody)?.runs)
}

export async function issueRunContext(
  deps: Pick<AppDeps, 'config' | 'db'>,
  db: Database,
  projectId: string,
  title: string,
): Promise<IssueRunContext> {
  const empty: IssueRunContext = {
    available: false,
    branchPattern: PROJECT_CONFIG_DEFAULTS.branchPattern,
    proposedBranch: proposedIssueBranch(PROJECT_CONFIG_DEFAULTS.branchPattern, title),
    defaultType: 'fix',
    types: [...BRANCH_TYPES],
    agents: [],
    defaultAgentId: null,
  }
  const bound = await taskflowPrefixFor(deps, db, projectId)
  if (!bound) return empty
  const prefix = encodeURIComponent(bound.prefix)
  const config = (await hostJson(deps.config, `/api/modules/taskflow/${prefix}/api/config`)) as HostConfig | null
  if (!config) return empty
  const branchPattern = stringOf(config.branchPattern) ?? PROJECT_CONFIG_DEFAULTS.branchPattern
  const agents = Array.isArray(config.agents)
    ? config.agents.flatMap((entry) => {
        const row = asRecord(entry)
        const id = stringOf(row?.id)
        const label = stringOf(row?.label) ?? id
        return id && label ? [{ id, label }] : []
      })
    : []
  return {
    available: agents.length > 0,
    branchPattern,
    proposedBranch: proposedIssueBranch(branchPattern, title),
    defaultType: 'fix',
    types: [...BRANCH_TYPES],
    agents,
    defaultAgentId: stringOf(config.defaultAgentId),
  }
}

export async function startIssueRun(
  deps: Pick<AppDeps, 'config' | 'db'>,
  db: Database,
  input: {
    projectId: string
    issueRef: string
    title: string
    body: string | null
    harness: string
    type?: string
    branch?: string
  },
): Promise<{ runId: string } | { error: string; status: number }> {
  const bound = await taskflowPrefixFor(deps, db, input.projectId)
  if (!bound) return { error: 'This project has no Taskflow workspace', status: 409 }
  const context = await issueRunContext(deps, db, input.projectId, input.title)
  if (!context.available) return { error: 'No agent is configured for this project', status: 409 }
  const type = input.type && isBranchType(input.type) ? input.type : 'fix'
  const branch = input.branch?.trim() || proposedIssueBranch(context.branchPattern, input.title, type)
  const prompt = [
    `Resolve ${input.issueRef}: ${input.title}`,
    input.body && input.body.trim() !== '' ? input.body : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')
  const prefix = encodeURIComponent(bound.prefix)
  const body = await hostJson(
    deps.config,
    `/api/modules/taskflow/${prefix}/api/projects/${prefix}/runs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'direct',
        harness: input.harness,
        input: { prompt },
        idempotencyKey: randomUUID(),
        issueRef: input.issueRef,
        transport: 'acp',
        workspace: { strategy: 'isolated_worktree', branch },
      }),
    },
    60_000,
  )
  const run = asRecord(asRecord(body)?.run)
  const runId = stringOf(run?.id)
  if (!runId) return { error: 'The Run could not be started', status: 502 }
  return { runId }
}
