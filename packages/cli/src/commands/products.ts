// `portta projects`: the product, from the terminal or from an agent.
//
// A Project is a decision the panel persists, so every verb here is one call
// to the panel API — the same answers the UI and `portta mcp` get. `envs` is
// the other noun: what Docker is running, read locally.

import type { Command } from 'commander'
import { issueRefLabel } from 'portta-core'
import { segment } from '../api.js'
import { ago, clientFor, csv, query, table } from './work.js'

interface ProjectSummary {
  id: string
  slug: string
  name: string
  description: string | null
  archived: boolean
  location: string
  repositoryCount: number
  environmentCount: number
  runningEnvironmentCount: number
}
interface Project extends ProjectSummary {
  resolvedPath: string | null
  repositories: Array<{
    id: string
    name: string
    role: string | null
    provider: string
    scanPath: string | null
    localPath: string | null
    git: { branch: string | null; dirty: boolean; ahead: number; behind: number } | null
    environments: string[]
    instructionCount: number
  }>
  environments: Array<{
    environment: string
    source: string
    running: boolean
    serviceCount: number
    runningCount: number
    unhealthyCount: number
  }>
}

export async function projectsList(_options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ projects: ProjectSummary[] }>('GET', '/projects')
  if (output.json) return output.data(body)
  if (body.projects.length === 0)
    return output.progress('no projects yet: create one in the panel or with `portta projects create`')
  table(output, [
    ['SLUG', 'NAME', 'REPOS', 'ENVS', 'RUNNING', 'WHERE'],
    ...body.projects.map((p) => [
      p.slug,
      p.name,
      String(p.repositoryCount),
      String(p.environmentCount),
      String(p.runningEnvironmentCount),
      p.location,
    ]),
  ])
}

export async function projectsShow(slug: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const project = await client.request<Project>('GET', `/projects/${segment(slug)}`)
  if (output.json) return output.data(project)
  output.line(`${project.name} (${project.slug})${project.archived ? ' · archived' : ''}`)
  if (project.description) output.line(`  ${project.description}`)
  if (project.resolvedPath) output.line(`  ${project.resolvedPath} · ${project.location}`)
  if (project.repositories.length > 0) {
    output.line('  repositories:')
    for (const r of project.repositories) {
      const git = r.git
        ? `${r.git.branch ?? 'detached'}${r.git.dirty ? ' (dirty)' : ''}${r.git.ahead ? ` ↑${r.git.ahead}` : ''}${r.git.behind ? ` ↓${r.git.behind}` : ''}`
        : 'not collected'
      output.line(
        `    ${r.name.padEnd(20)} ${(r.role ?? '-').padEnd(8)} ${git.padEnd(24)} ${r.environments.join(',') || '-'}${r.instructionCount ? `  ${r.instructionCount} instruction file(s)` : ''}`,
      )
    }
  }
  if (project.environments.length > 0) {
    output.line('  environments:')
    for (const e of project.environments)
      output.line(
        `    ${e.environment.padEnd(24)} ${e.running ? `${e.runningCount}/${e.serviceCount} running` : 'stopped'}${e.unhealthyCount ? ` · ${e.unhealthyCount} unhealthy` : ''}  [${e.source}]`,
      )
  }
}

export async function projectsCreate(
  options: { slug?: string; name?: string; description?: string; path?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const name = options.name ?? options.slug
  const slug =
    options.slug ??
    name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const project = await client.request<Project>('POST', '/projects', {
    slug,
    name,
    description: options.description ?? null,
    ...(options.path ? { relativePath: options.path } : {}),
  })
  if (output.json) return output.data(project)
  output.progress(`created ${project.name} (${project.slug})`)
}

export async function projectsContext(slug: string, options: { issue?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const context = await client.request<Record<string, unknown>>(
    'GET',
    `/projects/${segment(slug)}/context${query({ issue: options.issue })}`,
  )
  if (output.json) return output.data(context)
  const project = context.project as { name: string; slug: string; path: string | null }
  const issue = context.issue as { ref: string; title: string; state: string; url: string } | null
  const repositories = context.repositories as Array<{
    name: string
    path: string | null
    git: { branch: string | null; dirty: boolean; base: string | null } | null
    instructions: Array<{ path: string }>
    worktrees: Array<{ path: string; branch: string; base: string | null; environment: string | null }>
  }>
  const environments = context.environments as Array<{
    name: string
    running: boolean
    branch: string | null
    startCommand: string
    services: Array<{ name: string; state: string; access: { primary: { url: string } | null } }>
  }>
  const instructions = context.instructions as { issue: string | null }
  // Absent on a panel older than this CLI: nothing to say, rather than a crash.
  const diagnostics = (context.diagnostics ?? []) as Array<{
    status: string
    title: string
    detail: string
    fix: string
  }>
  output.line(`# ${project.name} (${project.slug})${project.path ? ` · ${project.path}` : ''}`)
  output.line('')
  if (issue) {
    output.line(`issue: ${issueRefLabel(issue.ref)} ${issue.title} · ${issue.state} · ${issue.url}`)
    output.line('')
  }
  for (const r of repositories) {
    output.line(
      `repository ${r.name}${r.path ? ` at ${r.path}` : ''}${r.git ? ` · ${r.git.branch ?? 'detached'}${r.git.base ? ` ← ${r.git.base}` : ''}${r.git.dirty ? ' (dirty)' : ''}` : ''}${r.instructions.length ? ` · reads ${r.instructions.map((f) => f.path).join(', ')}` : ''}`,
    )
    for (const w of r.worktrees ?? [])
      output.line(
        `  worktree ${w.path} · ${w.branch}${w.base ? ` ← ${w.base}` : ''}${w.environment ? ` · ${w.environment}` : ''}`,
      )
  }
  for (const e of environments) {
    output.line(
      `environment ${e.name} · ${e.running ? 'running' : `stopped (${e.startCommand})`}${e.branch ? ` · ${e.branch}` : ''}`,
    )
    for (const s of e.services)
      output.line(`  ${s.name.padEnd(16)} ${s.state.padEnd(10)} ${s.access.primary?.url ?? '-'}`)
  }
  if (instructions.issue) {
    output.line('')
    output.line(instructions.issue)
  }
  // What needs doing before work starts, the worst first: a person reads the
  // top line and acts; an agent reads the same list in --json.
  const rank = { fail: 0, warn: 1, info: 2, pass: 3 } as Record<string, number>
  const pending = diagnostics
    .filter((d) => d.status !== 'pass')
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
  if (pending.length > 0) {
    output.line('')
    for (const d of pending) output.line(`${d.status.padEnd(5)} ${d.title}: ${d.detail}${d.fix ? ` -> ${d.fix}` : ''}`)
  }
  output.line('')
  output.line('(the platform rules and the full instruction files are in --json)')
}

export async function projectsResources(slug: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{
    project: string
    stale: boolean
    collectorActive: boolean
    cpuUtilisation: number | null
    memoryUsedBytes: number | null
    environments: Array<{
      environment: string
      cpuUtilisation: number | null
      memoryUsedBytes: number | null
      containers: Array<{
        name: string
        service: string | null
        cpuUtilisation: number | null
        memoryUsedBytes: number | null
      }>
    }>
  }>('GET', `/projects/${segment(slug)}/resources`)
  if (output.json) return output.data(body)
  if (!body.collectorActive) output.warning('the metrics collector is not running: `portta host watch`')
  const mb = (bytes: number | null) => (bytes === null ? '-' : `${Math.round(bytes / 1048576)} MB`)
  const pct = (value: number | null) => (value === null ? '-' : `${Math.round(value)}%`)
  output.line(
    `${body.project}: CPU ${pct(body.cpuUtilisation)} · RAM ${mb(body.memoryUsedBytes)}${body.stale ? ' (stale)' : ''}`,
  )
  for (const e of body.environments) {
    output.line(`  ${e.environment}: CPU ${pct(e.cpuUtilisation)} · RAM ${mb(e.memoryUsedBytes)}`)
    for (const c of e.containers)
      output.line(
        `    ${(c.service ?? c.name).padEnd(20)} ${pct(c.cpuUtilisation).padStart(5)}  ${mb(c.memoryUsedBytes)}`,
      )
  }
}

export async function projectsActivity(
  slug: string,
  options: { kind?: string; limit?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{
    events: Array<{ at: number; kind: string; actor: string | null; summary: string }>
  }>('GET', `/projects/${segment(slug)}/activity${query({ kind: csv(options.kind)?.join(','), limit: options.limit })}`)
  if (output.json) return output.data(body)
  table(
    output,
    body.events.map((e) => [ago(e.at), e.kind, e.actor ?? '-', e.summary]),
  )
}

export async function overviewCommand(_options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<Record<string, unknown>>('GET', '/overview')
  if (output.json) return output.data(body)
  const work = body.work as {
    available: boolean
    assigned: Array<{ ref: string; title: string }>
    unavailableReason: string | null
  }
  const sessions = body.sessions as Array<{
    actor: string
    project: string
    issueRef: string | null
    lastActivityAt: number
  }>
  const attention = body.attention as Array<{ severity: string; summary: string }>
  const projects = body.projects as Array<{
    slug: string
    activeSessions: number
    runningEnvironments: number
    unhealthyServices: number
    health: string
  }>
  // An empty list with no provider reached means "not known", and saying
  // "0 assigned" there would read as "nothing to do".
  if (!work.available) output.line(`work: unknown${work.unavailableReason ? ` (${work.unavailableReason})` : ''}`)
  else output.line(`work: ${work.assigned.length} issue(s) assigned to you`)
  for (const issue of work.assigned) output.line(`  ${issueRefLabel(issue.ref)} ${issue.title}`)
  for (const s of sessions)
    output.line(
      `session: ${s.actor} on ${s.project}${s.issueRef ? ` ${issueRefLabel(s.issueRef)}` : ''} · ${ago(s.lastActivityAt)} ago`,
    )
  for (const a of attention) output.line(`${a.severity === 'fail' ? '✖' : '⚠'} ${a.summary}`)
  table(output, [
    ['PROJECT', 'SESSIONS', 'ENVS UP', 'UNHEALTHY', 'HEALTH'],
    ...projects.map((p) => [
      p.slug,
      String(p.activeSessions),
      String(p.runningEnvironments),
      String(p.unhealthyServices),
      p.health,
    ]),
  ])
}

export async function envLogs(
  name: string,
  options: { service?: string; tail?: string },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ lines: Array<{ service: string; line: string; stream?: string }> }>(
    'GET',
    `/environments/${segment(name)}/logs${query({ service: options.service, tail: options.tail })}`,
  )
  if (output.json) return output.data(body)
  for (const entry of body.lines) output.line(`${entry.service.padEnd(12)} | ${entry.line}`)
}
