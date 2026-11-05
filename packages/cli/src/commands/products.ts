// `portta projects`: the product, from the terminal or from an agent.
//
// A Project is a decision the panel persists, so every verb here is one call
// to the panel API — the same answers the UI gets. `envs` is
// the other noun: what Docker is running, read locally.

import { isAbsolute, resolve } from 'node:path'
import type { Command } from 'commander'
import { segment } from '../api.js'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { projectsHomeOf } from '../metrics/discovery.js'
import { clientFor, query, table } from './work.js'

interface ProjectSummary {
  tags?: ProjectTag[]
  id: string
  slug: string
  name: string
  description: string | null
  archived: boolean
  location: string
  environmentCount: number
  runningEnvironmentCount: number
}
interface ProjectTag {
  key: string
  value: string
}
interface Project extends ProjectSummary {
  tags?: ProjectTag[]
  resolvedPath: string | null
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
    ['SLUG', 'NAME', 'ENVS', 'RUNNING', 'WHERE', 'TAGS'],
    ...body.projects.map((p) => [
      p.slug,
      p.name,
      String(p.environmentCount),
      String(p.runningEnvironmentCount),
      p.location,
      (p.tags ?? []).map(tagText).join(', '),
    ]),
  ])
}

const MAX_TAGS = 16

export function tagText(tag: ProjectTag): string {
  return tag.key === '' ? tag.value : `${tag.key}: ${tag.value}`
}

/** `cliente: Acme` or `loja`: everything before the first colon is the key, lowercased, as the panel reads it. */
export function parseTagText(text: string): ProjectTag {
  const at = text.indexOf(':')
  const key = at < 0 ? '' : text.slice(0, at).trim().toLowerCase()
  const value = (at < 0 ? text : text.slice(at + 1)).trim()
  if (value === '' || key.length > 32 || value.length > 64) {
    throw new UsageError(
      `'${text}' is not a tag`,
      'write a tag as `loja` or `cliente: Acme`: key up to 32, value up to 64',
    )
  }
  return { key, value }
}

/** The tags after removing what was asked and adding what was asked, in the order they were. */
export function changeTags(
  current: readonly ProjectTag[],
  add: readonly string[],
  remove: readonly string[],
): ProjectTag[] {
  const gone = new Set(remove.map((text) => tagText(parseTagText(text))))
  const kept = current.filter((tag) => !gone.has(tagText(tag)))
  const next = [...kept]
  for (const text of add) {
    const tag = parseTagText(text)
    if (!next.some((other) => tagText(other) === tagText(tag))) next.push(tag)
  }
  if (next.length > MAX_TAGS) throw new UsageError(`a project carries at most ${MAX_TAGS} tags`)
  return next
}

export async function projectsTag(
  slug: string,
  options: { add?: string[]; remove?: string[]; clear?: boolean },
  command: Command,
): Promise<void> {
  const { client, output } = clientFor(command)
  const project = await client.request<Project>('GET', `/projects/${segment(slug)}`)
  const asked = (options.add?.length ?? 0) + (options.remove?.length ?? 0) > 0 || options.clear === true
  const tags = asked
    ? changeTags(options.clear ? [] : (project.tags ?? []), options.add ?? [], options.remove ?? [])
    : (project.tags ?? [])
  const updated = asked
    ? await client.request<ProjectSummary>('PUT', `/projects/${segment(slug)}/tags`, { tags })
    : project
  if (output.json) return output.data(updated)
  output.line(`${project.slug}: ${tags.length > 0 ? tags.map(tagText).join(', ') : 'no tags'}`)
}

export async function projectsShow(slug: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const project = await client.request<Project>('GET', `/projects/${segment(slug)}`)
  if (output.json) return output.data(project)
  output.line(`${project.name} (${project.slug})${project.archived ? ' · archived' : ''}`)
  if (project.description) output.line(`  ${project.description}`)
  if (project.resolvedPath) output.line(`  ${project.resolvedPath} · ${project.location}`)
  if (project.environments.length > 0) {
    output.line('  environments:')
    for (const e of project.environments)
      output.line(
        `    ${e.environment.padEnd(24)} ${e.running ? `${e.runningCount}/${e.serviceCount} running` : 'stopped'}${e.unhealthyCount ? ` · ${e.unhealthyCount} unhealthy` : ''}  [${e.source}]`,
      )
  }
}

/**
 * What the panel stores as a Project's directory: a path under Projects Home. Somebody standing in the
 * folder types `.` or the absolute path, and a path already relative to the home is passed as it is.
 */
export function relativeProjectPath(input: string, home: string | null, cwd: string = process.cwd()): string {
  const given = input.trim()
  if (given !== '.' && !given.startsWith('./') && !given.startsWith('../') && !isAbsolute(given)) return given
  const absolute = resolve(cwd, given)
  if (!home) {
    throw new UsageError(
      `cannot place ${absolute} under Projects Home: it is not known on this host`,
      'set PORTTA_PROJECTS_HOME, or pass the path relative to it, such as group/project',
    )
  }
  const base = home.replace(/\/+$/, '')
  if (!absolute.startsWith(`${base}/`)) {
    throw new UsageError(`${absolute} is not under Projects Home (${base})`, 'a Project lives inside Projects Home')
  }
  return absolute.slice(base.length + 1)
}

function projectsHome(profile?: string): string | null {
  try {
    return projectsHomeOf(gatewayContext({ profile, required: false }).root)
  } catch {
    return null
  }
}

export async function projectsCreate(
  options: { slug?: string; name?: string; description?: string; path?: string; environments?: string },
  command: Command,
): Promise<void> {
  const { client, output, globals } = clientFor(command)
  const name = options.name ?? options.slug
  const slug =
    options.slug ??
    name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const relativePath = options.path ? relativeProjectPath(options.path, projectsHome(globals.profile)) : null
  const environments = (options.environments ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const created = await client.request<Project>('POST', '/projects', {
    slug,
    name,
    description: options.description ?? null,
    ...(relativePath ? { relativePath } : {}),
  })
  // By hand, so an environment that runs from another folder, or that nothing runs now, comes along too.
  const project =
    environments.length > 0
      ? await client.request<Project>('PUT', `/projects/${segment(created.slug)}/environments`, { environments })
      : created
  if (output.json) return output.data(project)
  output.progress(`created ${project.name} (${project.slug})`)
  if (environments.length > 0) output.progress(`adopted ${environments.join(', ')}`)
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
