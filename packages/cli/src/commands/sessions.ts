// `portta sessions`: say that you are working, and on what.
//
// A session is how the panel answers "who is working on this, since when":
// an agent starts one before it touches a repository and ends it when it is
// done, and the commit watcher attributes what landed in between.

import type { Command } from 'commander'
import { issueRefLabel } from 'portta-core'
import { segment } from '../api.js'
import { ago, clientFor, requireProject, table } from './work.js'

interface Session {
  id: string
  project: string
  issueRef: string | null
  repository: { name: string } | null
  environment: string | null
  actor: string
  actorKind: string
  status: string
  startedAt: number
  lastActivityAt: number
  endedAt: number | null
  summary: string | null
  commits: { sha: string; subject: string }[]
}

function line(session: Session): string[] {
  return [
    session.id,
    session.status,
    session.actor,
    session.issueRef ? issueRefLabel(session.issueRef) : '-',
    session.repository?.name ?? '-',
    session.environment ?? '-',
    `${session.commits.length}`,
    ago(session.startedAt),
    session.summary ?? '',
  ]
}

export async function sessionsList(options: { project?: string; active?: boolean }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ sessions: Session[] }>(
    'GET',
    `/projects/${segment(requireProject(options.project))}/sessions${options.active ? '?active=true' : ''}`,
  )
  if (output.json) return output.data(body)
  if (body.sessions.length === 0) return output.line('no sessions')
  table(output, [
    ['id', 'status', 'actor', 'issue', 'repo', 'env', 'commits', 'since', 'summary'],
    ...body.sessions.map(line),
  ])
}

export async function sessionsStart(
  options: {
    project?: string
    issue?: string
    repository?: string
    environment?: string
    summary?: string
    head?: string
  },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const session = await client.request<Session>(
    'POST',
    `/projects/${segment(requireProject(options.project))}/sessions`,
    {
      ...(options.issue ? { issueRef: options.issue } : {}),
      ...(options.repository ? { repositoryId: options.repository } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
      ...(options.head ? { headBefore: options.head } : {}),
    },
  )
  if (output.json) return output.data(session)
  output.line(session.id)
  output.progress(
    `session ${session.id} started as ${session.actor}; end it with \`portta sessions end ${session.id}\``,
  )
}

export async function sessionsEnd(
  id: string,
  options: { summary?: string; abandon?: boolean; head?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const session = await client.request<Session>('PATCH', `/sessions/${segment(id)}`, {
    status: options.abandon ? 'abandoned' : 'ended',
    ...(options.summary !== undefined ? { summary: options.summary } : {}),
    ...(options.head ? { headAfter: options.head } : {}),
  })
  if (output.json) return output.data(session)
  output.progress(`session ${session.id} ${session.status}; ${session.commits.length} commit(s) recorded`)
}

export async function sessionsHeartbeat(id: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const session = await client.request<Session>('PATCH', `/sessions/${segment(id)}`, { heartbeat: true })
  if (output.json) return output.data(session)
  output.progress(`session ${session.id} is ${session.status}`)
}
