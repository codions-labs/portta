// One shape for a project in a list, whatever the panel could learn about it.
//
// The catalog (`/projects`) says what a project owns; the development
// dashboard says what is happening in it. Both were rendered through a union
// type, which meant every list decided for itself which half it had. This
// merges them once: the counts are null when the dashboard is unavailable, and
// a component reads one object either way.

import type { Environment, ProjectPulse, ProjectSummary, ProjectTag } from 'portta-contracts'
import type { ProjectEnvironmentFacts } from '../components/entities/project-actions.tsx'

export type ProjectState = 'archived' | 'unhealthy' | 'partial' | 'running' | 'idle'

export interface ProjectListItem {
  slug: string
  name: string
  description: string | null
  archived: boolean
  /** Kept at the top of the list by whoever may update it. */
  pinned: boolean
  /** Where it sits under Projects Home, such as `powertech/lms-platform`; null when it has no directory. */
  relativePath: string | null
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
    pinned: summary.pinned,
    relativePath: summary.relativePath,
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
    pinned: false,
    relativePath: null,
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
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
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

export type ProjectGrouping = 'none' | 'state' | 'folder' | `tag:${string}`

/** The first folder under Projects Home: the client, or the group, a project sits in. Null for one at the top. */
export function folderOfProject(item: Pick<ProjectListItem, 'relativePath'>): string | null {
  const path = item.relativePath?.replace(/^\/+|\/+$/g, '')
  if (!path?.includes('/')) return null
  return path.split('/')[0] ?? null
}

/** Whether the list has folders to group by: a project sitting one level down or deeper. */
export function hasFolders(items: readonly ProjectListItem[]): boolean {
  return items.some((item) => folderOfProject(item) !== null)
}

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
  labels: {
    state: (state: ProjectState) => string
    without: (key: string) => string
    noFolder?: string
    pinned?: string
    others?: string
  },
): ProjectBand[] {
  if (grouping === 'folder') {
    const folders = new Map<string, ProjectListItem[]>()
    const loose: ProjectListItem[] = []
    for (const item of items) {
      const folder = folderOfProject(item)
      if (folder === null) loose.push(item)
      else folders.set(folder, [...(folders.get(folder) ?? []), item])
    }
    return [
      ...[...folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, list]) => ({ id: `folder:${folder}`, title: folder, items: list })),
      ...(loose.length > 0 ? [{ id: 'folder:', title: labels.noFolder ?? '', items: loose }] : []),
    ]
  }
  if (grouping === 'none') {
    const pinned = items.filter((item) => item.pinned)
    if (pinned.length === 0 || pinned.length === items.length) return [{ id: 'all', title: null, items: [...items] }]
    return [
      { id: 'pinned', title: labels.pinned ?? '', items: pinned },
      { id: 'all', title: labels.others ?? '', items: items.filter((item) => !item.pinned) },
    ]
  }
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

export interface FolderGroup {
  /** The folder the environments run from, or null for the ones that name none or are alone in theirs. */
  folder: string | null
  environments: Environment[]
}

/**
 * The folder an environment runs from. Its labels say so when Compose started it; one that was started
 * by hand has none, and then the folder is the one of another environment that holds every file the
 * environment mounts from the host. Named volumes are not files of a folder, and nothing is guessed when
 * two folders could be it or when the mounts reach outside all of them.
 */
function folderOf(environment: Environment, known: readonly string[]): string | null {
  if (environment.workingDir) return environment.workingDir
  const sources = environment.services
    .flatMap((service) => service.mounts ?? [])
    .map((mount) => mount.source)
    .filter((source) => source.startsWith('/') && !source.startsWith('/var/lib/docker/'))
  if (sources.length === 0) return null
  const holders = known.filter((folder) =>
    sources.every((source) => source.startsWith(`${folder}/`) || source === folder),
  )
  return holders.length === 1 ? (holders[0] ?? null) : null
}

/**
 * Environments nobody adopted, with the ones that run from the same folder together.
 *
 * Docker names an environment by its Compose project, and one folder easily runs several: the one
 * adopted for the branch it is on, one the tests start with `-p`, a container somebody started by hand.
 * They are one product, and listing each by itself makes it look like three. A folder with a single
 * environment is not a group, and an environment that names no folder stays where it is.
 */
export function groupByFolder(environments: readonly Environment[]): FolderGroup[] {
  const named = [
    ...new Set(environments.flatMap((environment) => (environment.workingDir ? [environment.workingDir] : []))),
  ]
  const folders = new Map<string, string | null>(
    environments.map((environment) => [environment.name, folderOf(environment, named)]),
  )
  const byFolder = new Map<string, Environment[]>()
  for (const environment of environments) {
    const folder = folders.get(environment.name)
    if (folder) byFolder.set(folder, [...(byFolder.get(folder) ?? []), environment])
  }
  const groups: FolderGroup[] = []
  const placed = new Set<string>()
  for (const environment of environments) {
    const folder = folders.get(environment.name) ?? null
    const together = folder ? (byFolder.get(folder) ?? []) : []
    if (folder && together.length > 1) {
      if (placed.has(folder)) continue
      placed.add(folder)
      groups.push({ folder, environments: together })
    } else {
      groups.push({ folder: null, environments: [environment] })
    }
  }
  return groups
}

/** `/root/projects/tuttoria/tuttoria` becomes the folder's own name, `tuttoria`, to start from. */
export function projectNameOfFolder(folder: string): string {
  const last = folder.replace(/\/+$/, '').split('/').at(-1) ?? folder
  return last
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}

/** Where a folder sits under Projects Home, which is what lets a project adopt what runs there later. */
export function relativeToHome(folder: string, home: string | null | undefined): string | null {
  if (!home) return null
  const base = home.replace(/\/+$/, '')
  return folder.startsWith(`${base}/`) ? folder.slice(base.length + 1) : null
}
