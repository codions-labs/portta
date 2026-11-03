// One shape for a project in a list, whatever the panel could learn about it.
//
// The catalog (`/projects`) says what a project owns; the development
// dashboard says what is happening in it. Both were rendered through a union
// type, which meant every list decided for itself which half it had. This
// merges them once: the counts are null when the dashboard is unavailable, and
// a component reads one object either way.

import type { ProjectPulse, ProjectSummary, ProjectTag } from 'portta-contracts'
import type { ProjectEnvironmentFacts } from '../components/entities/project-actions.tsx'

export type ProjectState = 'archived' | 'unhealthy' | 'partial' | 'running' | 'idle'

export interface ProjectListItem {
  slug: string
  name: string
  description: string | null
  archived: boolean
  tags: ProjectTag[]
  environmentCount: number
  runningEnvironments: number
  unhealthyServices: number
  environments: ProjectEnvironmentFacts[]
  /**
   * The dashboard's own verdict on the project's environments. Null when the
   * dashboard is unavailable, and then the state is computed from the
   * environments the catalog listed.
   */
  health: ProjectPulse['health'] | null
  resources: ProjectPulse['resources']
}

export function toListItem(summary: ProjectSummary, pulse: ProjectPulse | undefined): ProjectListItem {
  return {
    slug: summary.slug,
    name: summary.name,
    description: summary.description,
    archived: summary.archived,
    tags: summary.tags,
    environmentCount: summary.environmentCount,
    runningEnvironments: summary.runningEnvironmentCount,
    unhealthyServices:
      pulse?.unhealthyServices ?? summary.environments.reduce((sum, entry) => sum + entry.unhealthyCount, 0),
    environments: summary.environments.map((entry) => ({ ...entry })),
    health: pulse?.health ?? null,
    resources: pulse?.resources ?? null,
  }
}

export function toListItems(
  summaries: readonly ProjectSummary[],
  pulses: readonly ProjectPulse[] | undefined,
): ProjectListItem[] {
  const byslug = new Map((pulses ?? []).map((pulse) => [pulse.slug, pulse]))
  return summaries.map((summary) => toListItem(summary, byslug.get(summary.slug)))
}

/**
 * One word for what a project is doing.
 *
 * Archived wins over everything: an archived project's containers are not
 * news. After that the worst true thing wins, because a list is scanned for
 * problems, not for reassurance.
 */
export function projectState(item: ProjectListItem): ProjectState {
  if (item.archived) return 'archived'
  if (item.health) return item.health === 'ok' ? 'running' : item.health
  if (item.unhealthyServices > 0) return 'unhealthy'
  if (item.runningEnvironments === 0) return 'idle'
  const degraded = item.environments.some(
    (environment) => environment.running && environment.runningCount < environment.serviceCount,
  )
  return degraded ? 'partial' : 'running'
}

/**
 * A project the dashboard knows about but the catalog has not been read for.
 *
 * The Overview holds pulses only, so its rows carry the counts and the state
 * but no environment names — which is correct: a dashboard row links to the
 * project, it does not operate it.
 */
export function fromPulse(pulse: ProjectPulse): ProjectListItem {
  return {
    slug: pulse.slug,
    name: pulse.name,
    description: null,
    archived: pulse.archived,
    tags: [],
    environmentCount: pulse.environmentCount,
    runningEnvironments: pulse.runningEnvironments,
    unhealthyServices: pulse.unhealthyServices,
    environments: [],
    health: pulse.health,
    resources: pulse.resources,
  }
}

export function projectStateTone(state: ProjectState): 'ok' | 'warn' | 'danger' | 'neutral' | 'outline' {
  switch (state) {
    case 'running':
      return 'ok'
    case 'partial':
      return 'warn'
    case 'unhealthy':
      return 'danger'
    case 'archived':
      return 'outline'
    default:
      return 'neutral'
  }
}

/** Worst first, so a state filter and a sort agree about what "top" means. */
const STATE_RANK: Record<ProjectState, number> = { unhealthy: 4, partial: 3, running: 2, idle: 1, archived: 0 }

export function projectStateRank(item: ProjectListItem): number {
  return STATE_RANK[projectState(item)]
}

export const PROJECT_VIEWS = ['cards', 'table'] as const
export type ProjectView = (typeof PROJECT_VIEWS)[number]

export function resolveProjectView(requested: string | null | undefined): ProjectView {
  return requested === 'table' ? 'table' : 'cards'
}

export interface ProjectFilters {
  search: string
  /** `problem` is both ways a project can be in trouble: unhealthy and partial. */
  state: ProjectState | 'all' | 'problem' | 'unpushed'
  includeArchived: boolean
  /** One tag, as `tagLabel` writes it; null for every project. */
  tag: string | null
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = { search: '', state: 'all', includeArchived: false, tag: null }

/**
 * Whether a project has code that is not committed or not pushed in any of its environments.
 * ``unpushed` is the set of environments the collector says so about; it reads them from the host.
 */
export function hasUnpushedCode(item: ProjectListItem, unpushed: ReadonlySet<string>): boolean {
  return item.environments.some((environment) => unpushed.has(environment.name))
}

export function matchesProjectFilters(
  item: ProjectListItem,
  filters: ProjectFilters,
  unpushed: ReadonlySet<string> = new Set(),
): boolean {
  if (item.archived && !filters.includeArchived && filters.state !== 'archived') return false
  if (filters.state === 'unpushed') {
    if (!hasUnpushedCode(item, unpushed)) return false
  } else if (filters.state === 'problem') {
    if (!['unhealthy', 'partial'].includes(projectState(item))) return false
  } else if (filters.state !== 'all' && projectState(item) !== filters.state) return false
  if (filters.tag !== null && !item.tags.some((tag) => tagLabel(tag) === filters.tag)) return false
  const needle = filters.search.trim().toLowerCase()
  if (needle === '') return true
  const haystack = [
    item.slug,
    item.name,
    item.description ?? '',
    ...item.tags.map(tagLabel),
    ...item.environments.map((environment) => environment.name),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

/** Most interesting first: problems, then running, then by name. */
export function defaultProjectOrder(left: ProjectListItem, right: ProjectListItem): number {
  const byState = projectStateRank(right) - projectStateRank(left)
  if (byState !== 0) return byState
  return left.name.localeCompare(right.name)
}

/** `cliente: Acme`, or `loja` for one with no key. */
export function tagLabel(tag: ProjectTag): string {
  return tag.key === '' ? tag.value : `${tag.key}: ${tag.value}`
}

/** What somebody typed, as a tag: everything before the first colon is the key. */
export function parseTag(text: string): ProjectTag | null {
  const at = text.indexOf(':')
  const key = at < 0 ? '' : text.slice(0, at).trim().toLowerCase()
  const value = (at < 0 ? text : text.slice(at + 1)).trim()
  return value === '' || key.length > 32 || value.length > 64 ? null : { key, value }
}

export const MAX_TAGS = 16

/** Every tag in use, most used first, so the chips lead with what groups the most. */
export function tagCounts(items: readonly ProjectListItem[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) for (const tag of item.tags) counts.set(tagLabel(tag), (counts.get(tagLabel(tag)) ?? 0) + 1)
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** The keys projects are tagged with, which are what a list can be grouped by. */
export function tagKeys(items: readonly ProjectListItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags.map((tag) => tag.key).filter((key) => key !== '')))].sort()
}

export type ProjectGrouping = 'none' | 'state' | `tag:${string}`

export interface ProjectBand {
  id: string
  /** Absent for the one band of a list that is not grouped. */
  title: string | null
  items: ProjectListItem[]
}

const STATE_ORDER: ProjectState[] = ['unhealthy', 'partial', 'running', 'idle', 'archived']

/** Bands in the order they read: states worst first, tag values by name, and "without" last. */
export function groupProjects(
  items: readonly ProjectListItem[],
  grouping: ProjectGrouping,
  labels: { state: (state: ProjectState) => string; without: (key: string) => string },
): ProjectBand[] {
  if (grouping === 'none') return [{ id: 'all', title: null, items: [...items] }]
  if (grouping === 'state') {
    return STATE_ORDER.map((state) => ({
      id: state,
      title: labels.state(state),
      items: items.filter((item) => projectState(item) === state),
    })).filter((band) => band.items.length > 0)
  }
  const key = grouping.slice(4)
  const bands = new Map<string, ProjectListItem[]>()
  const without: ProjectListItem[] = []
  for (const item of items) {
    const values = item.tags.filter((tag) => tag.key === key).map((tag) => tag.value)
    if (values.length === 0) without.push(item)
    // One project under each value it carries: a project for two clients is both clients' work.
    for (const value of values) bands.set(value, [...(bands.get(value) ?? []), item])
  }
  return [
    ...[...bands.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, list]) => ({ id: `${key}:${value}`, title: value, items: list })),
    ...(without.length > 0 ? [{ id: `${key}:`, title: labels.without(key), items: without }] : []),
  ]
}
