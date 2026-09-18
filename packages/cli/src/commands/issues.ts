// `portta issues`: the work, from the terminal or from an agent.
//
// Every verb is one call to the panel API, the same one the UI and `portta mcp`
// use. Nothing is computed here — which provider a Project uses, which
// repository that means, and whether a write reached GitHub are the panel's
// answers, printed.
//
// This is not a thinner `gh`. `gh issue list` needs a repository and Portta
// works in Projects, so the argument here is always `--project` and the
// repository comes from what the Project is linked to
// (docs/development/adr/0050-work-lives-in-an-external-provider.md). It also
// reaches issues in Linear, which `gh` cannot.

import { readFile } from 'node:fs/promises'
import type { Command } from 'commander'
import { segment } from '../api.js'
import { UsageError } from '../errors.js'
import { ago, clientFor, csv, query, requireProject, table } from './work.js'

interface IssueUser {
  login: string
}

interface IssueSummary {
  ref: string
  provider: 'github' | 'linear'
  key: string
  title: string
  state: 'open' | 'closed'
  stateReason: string | null
  labels: { name: string }[]
  assignees: IssueUser[]
  milestone: { title: string } | null
  commentCount: number
  updatedAt: number
  url: string
}

interface Issue extends IssueSummary {
  body: string | null
  comments: { id: string; author: IssueUser | null; body: string; createdAt: number }[]
  environments: { environment: string; source: string; reason: string; running: boolean }[]
  activeSessionCount: number
}

function line(issue: IssueSummary): string[] {
  return [
    issue.key,
    issue.state,
    issue.assignees.map((user) => user.login).join(',') || '-',
    issue.labels.map((label) => label.name).join(',') || '-',
    issue.commentCount > 0 ? String(issue.commentCount) : '-',
    ago(issue.updatedAt),
    issue.title,
  ]
}

function printIssue(output: ReturnType<typeof clientFor>['output'], issue: Issue): void {
  output.line(`${issue.key}  ${issue.title}`)
  output.line(
    `  ${issue.state}${issue.stateReason ? ` (${issue.stateReason})` : ''} · ${issue.provider} · ${issue.url}`,
  )
  if (issue.assignees.length > 0) output.line(`  assignees ${issue.assignees.map((user) => user.login).join(', ')}`)
  if (issue.labels.length > 0) output.line(`  labels ${issue.labels.map((label) => label.name).join(', ')}`)
  if (issue.milestone) output.line(`  milestone ${issue.milestone.title}`)
  // The one thing neither provider knows, so it is worth its own line.
  if (issue.environments.length > 0) {
    output.line(
      `  running in ${issue.environments.map((link) => `${link.environment}${link.running ? '' : ' (stopped)'} [${link.source}]`).join(', ')}`,
    )
  }
  if (issue.activeSessionCount > 0) output.line(`  ${issue.activeSessionCount} active session(s)`)
  if (issue.body) output.line(`\n${issue.body}`)
  for (const comment of issue.comments) {
    output.line(`\n--- ${comment.author?.login ?? 'someone'} · ${ago(comment.createdAt)}`)
    output.line(comment.body)
  }
}

/** The path a Project's issues answer on. `--project` is not optional anywhere. */
function base(project: string | undefined): string {
  return `/projects/${segment(requireProject(project))}/issues`
}

/**
 * A body given as text, or read from a file, or read from stdin.
 *
 * `--body-file -` is the shape `gh` uses and the one an agent reaches for: an
 * issue body is arbitrary Markdown, it can be longer than a command line
 * allows, and passing it as an argument puts it in the host's process listing.
 */
async function bodyOf(options: { body?: string; bodyFile?: string }): Promise<string | undefined> {
  if (options.bodyFile === '-') return readFile('/dev/stdin', 'utf8')
  if (options.bodyFile) return readFile(options.bodyFile, 'utf8')
  return options.body
}

export async function issuesList(
  options: { project?: string; state?: string; assignee?: string; label?: string; milestone?: string; q?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const state = options.state ?? 'open'
  if (!['open', 'closed', 'all'].includes(state))
    throw new UsageError(`unknown state '${state}'`, 'use open, closed or all')
  const { issues } = await client.request<{ issues: IssueSummary[] }>(
    'GET',
    `${base(options.project)}${query({ state, assignee: options.assignee, label: options.label, milestone: options.milestone, q: options.q })}`,
  )
  if (output.json) return output.data({ issues })
  if (issues.length === 0) return output.line('no issues')
  table(output, issues.map(line))
}

export async function issuesShow(ref: string, options: { project?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const issue = await client.request<{ issue: Issue }>('GET', `${base(options.project)}/${segment(keyOf(ref))}`)
  if (output.json) return output.data(issue.issue)
  printIssue(output, issue.issue)
}

export async function issuesCreate(
  title: string,
  options: {
    project?: string
    body?: string
    bodyFile?: string
    label?: string
    assignee?: string
    milestone?: string
  },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const { issue } = await client.request<{ issue: Issue }>('POST', base(options.project), {
    title,
    body: await bodyOf(options),
    labels: csv(options.label),
    assignees: csv(options.assignee),
    milestone: options.milestone,
  })
  if (output.json) return output.data(issue)
  output.line(`${issue.key}  ${issue.title}`)
  output.line(`  ${issue.url}`)
}

export async function issuesEdit(
  ref: string,
  options: {
    project?: string
    title?: string
    body?: string
    bodyFile?: string
    addLabel?: string
    removeLabel?: string
    addAssignee?: string
    removeAssignee?: string
    milestone?: string
  },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const { issue } = await client.request<{ issue: Issue }>('PATCH', `${base(options.project)}/${segment(keyOf(ref))}`, {
    title: options.title,
    body: await bodyOf(options),
    addLabels: csv(options.addLabel),
    removeLabels: csv(options.removeLabel),
    addAssignees: csv(options.addAssignee),
    removeAssignees: csv(options.removeAssignee),
    milestone: options.milestone,
  })
  if (output.json) return output.data(issue)
  printIssue(output, issue)
}

async function setState(
  ref: string,
  state: 'open' | 'closed',
  options: { project?: string; reason?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const reason = options.reason === 'not-planned' ? 'not planned' : options.reason
  const { issue } = await client.request<{ issue: Issue }>('PATCH', `${base(options.project)}/${segment(keyOf(ref))}`, {
    state,
    stateReason: reason,
  })
  if (output.json) return output.data(issue)
  output.line(`${issue.key} is ${issue.state}${issue.stateReason ? ` (${issue.stateReason})` : ''}`)
}

export const issuesClose = (ref: string, options: { project?: string; reason?: string }, command: Command) =>
  setState(ref, 'closed', options, command)
export const issuesReopen = (ref: string, options: { project?: string }, command: Command) =>
  setState(ref, 'open', options, command)

export async function issuesComment(
  ref: string,
  text: string | undefined,
  options: { project?: string; body?: string; bodyFile?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const body = text ?? (await bodyOf(options))
  if (!body?.trim()) throw new UsageError('a comment needs a body', 'pass it as an argument, or --body-file -')
  const { issue } = await client.request<{ issue: Issue }>(
    'POST',
    `${base(options.project)}/${segment(keyOf(ref))}/comments`,
    { body },
  )
  if (output.json) return output.data(issue)
  output.line(`commented on ${issue.key}`)
}

export async function issuesStatus(command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const status = await client.request<{ github: Provider; linear: Provider }>('GET', '/issues/status')
  if (output.json) return output.data(status)
  for (const [name, provider] of [
    ['github', status.github],
    ['linear', status.linear],
  ] as const) {
    output.line(
      provider.authenticated
        ? `${name.padEnd(8)} signed in as ${provider.account}`
        : `${name.padEnd(8)} ${provider.reason ?? (provider.available ? 'not signed in' : 'not on this host')}`,
    )
  }
}

interface Provider {
  available: boolean
  authenticated: boolean
  account: string | null
  reason: string | null
}

/**
 * The provider's own key from whatever somebody typed.
 *
 * `113`, `#113`, `github:owner/repo#113` and `ENG-42` all address an issue, and
 * the first two are what a person actually types. The panel's route takes the
 * key, so the ref is narrowed here rather than in six call sites.
 */
export function keyOf(raw: string): string {
  const value = raw.trim()
  const separator = value.indexOf(':')
  const key = separator > 0 ? value.slice(separator + 1) : value
  const hash = key.lastIndexOf('#')
  return (hash >= 0 ? key.slice(hash + 1) : key).trim()
}
