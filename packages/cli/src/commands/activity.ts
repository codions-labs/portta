// `portta activity`: what happened, newest first.

import type { Command } from 'commander'
import { segment } from '../api.js'
import { ago, clientFor, csv, query, table } from './work.js'

interface ActivityEvent {
  id: string
  at: number
  kind: string
  actor: string | null
  summary: string
  project: string | null
  issueRef: string | null
  environment: string | null
  repositoryName: string | null
}

export async function activityCommand(
  options: {
    project?: string
    kind?: string
    issue?: string
    repository?: string
    environment?: string
    limit?: string
  },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const search = query({
    kind: csv(options.kind)?.join(','),
    issue: options.issue,
    repository: options.repository,
    environment: options.environment,
    limit: options.limit,
  })
  const path = options.project ? `/projects/${segment(options.project)}/activity${search}` : `/activity${search}`
  const body = await client.request<{ events: ActivityEvent[] }>('GET', path)
  if (output.json) return output.data(body)
  if (body.events.length === 0) return output.line('nothing happened yet')
  table(output, [
    ['when', 'kind', 'who', 'project', 'summary'],
    ...body.events.map((event) => [
      `${ago(event.at)} ago`,
      event.kind,
      event.actor ?? '-',
      event.project ?? '-',
      event.summary,
    ]),
  ])
}
