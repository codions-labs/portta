// One shape for a project in a list, whatever the panel could learn about it.
//
// The catalog (`/projects`) says what a project owns; the development
// dashboard says what is happening in it. Both were rendered through a union
// type, which meant every list decided for itself which half it had. This
// merges them once: the counts are null when the dashboard is unavailable, and
// a component reads one object either way.

import type { ProjectPulse, ProjectSummary } from 'portta-contracts'
import type { ProjectEnvironmentFacts } from '../components/entities/project-actions.tsx'

export type ProjectState = 'archived' | 'unhealthy' | 'partial' | 'running' | 'idle'

export interface ProjectListItem {
  slug: string
  name: string
  description: string | null
  archived: boolean
  repositoryCount: number
  environmentCount: number
  runningEnvironments: number
  unhealthyServices: number
  environments: ProjectEnvironmentFacts[]
  /** Null when the dashboard is unavailable: the panel has no database. */
  activeSessions: number | null
  /**
   * The dashboard's own verdict on the project's environments. Null when the
   * dashboard is unavailable, and then the state is computed from the
   * environments the catalog listed.
   */
  health: ProjectPulse['health'] | null
  lastCommit: ProjectPulse['lastCommit']
  lastActivityAt: number | null
  lastActivity: string | null
  resources: ProjectPulse['resources']
}

export function toListItem(summary: ProjectSummary, pulse: ProjectPulse | undefined): ProjectListItem {
  return {
    slug: summary.slug,
    name: summary.name,
    description: summary.description,
    archived: summary.archived,
    repositoryCount: summary.repositoryCount,
    environmentCount: summary.environmentCount,
    runningEnvironments: summary.runningEnvironmentCount,
    unhealthyServices:
      pulse?.unhealthyServices ?? summary.environments.reduce((sum, entry) => sum + entry.unhealthyCount, 0),
    environments: summary.environments.map((entry) => ({ ...entry })),
    activeSessions: pulse?.activeSessions ?? null,
    health: pulse?.health ?? null,
    lastCommit: pulse?.lastCommit ?? null,
    lastActivityAt: pulse?.lastActivityAt ?? null,
    lastActivity: pulse?.lastActivity ?? null,
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
    repositoryCount: pulse.repositoryCount,
    environmentCount: pulse.environmentCount,
    runningEnvironments: pulse.runningEnvironments,
    unhealthyServices: pulse.unhealthyServices,
    environments: [],
    activeSessions: pulse.activeSessions,
    health: pulse.health,
    lastCommit: pulse.lastCommit,
    lastActivityAt: pulse.lastActivityAt,
    lastActivity: pulse.lastActivity,
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
  state: ProjectState | 'all'
  includeArchived: boolean
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = { search: '', state: 'all', includeArchived: false }

export function matchesProjectFilters(item: ProjectListItem, filters: ProjectFilters): boolean {
  if (item.archived && !filters.includeArchived && filters.state !== 'archived') return false
  if (filters.state !== 'all' && projectState(item) !== filters.state) return false
  const needle = filters.search.trim().toLowerCase()
  if (needle === '') return true
  const haystack = [
    item.slug,
    item.name,
    item.description ?? '',
    ...item.environments.map((environment) => environment.name),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

/** Most interesting first: problems, then work, then whatever moved last. */
export function defaultProjectOrder(left: ProjectListItem, right: ProjectListItem): number {
  const byState = projectStateRank(right) - projectStateRank(left)
  if (byState !== 0) return byState
  const byActivity = (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0)
  if (byActivity !== 0) return byActivity
  return left.name.localeCompare(right.name)
}
