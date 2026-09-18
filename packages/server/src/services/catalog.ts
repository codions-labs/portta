// Assemble a Project from the persisted grouping plus the live Environment
// snapshot and the host scan. See docs/development/adr/0031-projects-home-and-project.md.

import type { Project, ProjectEnvironment, ProjectLocation, ProjectSummary, Repository } from 'portta-contracts'
import { resolveProjectPath } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { ProjectRecord } from '../db/projects.ts'
import type { RepositoryRow } from '../db/repositories.ts'
import { type ProjectCoordinates, resolveAdoptions } from './adoption.ts'
import type { Snapshot } from './inventory.ts'
import { coordinateFor, NoProvider, providerFor } from './issues/provider.ts'
import { rememberedEnvironments } from './remembered.ts'
import { coordinateOf, loadScans, type RepositoryScans, toRepository } from './repositories.ts'

/** The panel cannot stat the host: with a stored path it is managed, without one it is external. */
export function projectLocationOf(relativePath: string | null): ProjectLocation {
  return relativePath ? 'managed' : 'external'
}

export function resolvedPathOf(projectsHome: string | null, relativePath: string | null): string | null {
  if (!projectsHome || !relativePath) return null
  try {
    return resolveProjectPath(projectsHome, relativePath)
  } catch {
    return null
  }
}

/** The Project's provider and coordinate, or why it has none. */
function workOf(record: ProjectRecord, repositories: Repository[]): Project['work'] {
  const facts = {
    slug: record.slug,
    taskProvider: record.taskProvider,
    repositories: repositories.map((repository, index) => ({ remoteUrl: repository.remoteUrl, position: index })),
    linearTeam: record.linearTeam,
  }
  try {
    const coordinate = coordinateFor(facts)
    return {
      provider: coordinate.provider,
      coordinate: coordinate.provider === 'github' ? coordinate.repo : coordinate.team,
      reason: null,
    }
  } catch (error) {
    return {
      provider: providerFor(facts),
      coordinate: null,
      reason: error instanceof NoProvider ? `${error.message} — ${error.hint}` : String(error),
    }
  }
}

export function toProjectSummary(
  record: ProjectRecord,
  repositoryCount: number,
  adopted: ProjectEnvironment[],
): ProjectSummary {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    archived: record.archived,
    taskProvider: record.taskProvider,
    linearTeam: record.linearTeam,
    relativePath: record.relativePath,
    location: projectLocationOf(record.relativePath),
    repositoryCount,
    environmentCount: adopted.length,
    runningEnvironmentCount: adopted.filter((environment) => environment.running).length,
    environments: adopted.map((environment) => ({
      name: environment.environment,
      running: environment.running,
      serviceCount: environment.serviceCount,
      runningCount: environment.runningCount,
      unhealthyCount: environment.unhealthyCount,
    })),
  }
}

export function toProject(
  record: ProjectRecord,
  repositories: Repository[],
  adopted: ProjectEnvironment[],
  projectsHome: string | null,
): Project {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    archived: record.archived,
    taskProvider: record.taskProvider,
    linearTeam: record.linearTeam,
    // Resolved here rather than by every caller: the panel shows "GitHub
    // Issues on codions-labs/portta" on the project page, and the reason is
    // what it shows instead when there is nothing to show.
    work: workOf(record, repositories),
    relativePath: record.relativePath,
    resolvedPath: resolvedPathOf(projectsHome, record.relativePath),
    location: projectLocationOf(record.relativePath),
    repositories,
    environments: adopted,
  }
}

export interface ProjectCatalog {
  records: ProjectRecord[]
  repositoriesByProject: Map<string, Repository[]>
  environments: Map<string, ProjectEnvironment[]>
  projectsHome: string | null
  scans: RepositoryScans
}

/** The coordinates adoption resolves against: names, remotes, paths and scan keys. */
export function coordinatesOf(
  record: ProjectRecord,
  rows: readonly RepositoryRow[],
  repositories: readonly Repository[],
  projectsHome: string | null,
): ProjectCoordinates {
  const resolved = resolvedPathOf(projectsHome, record.relativePath)
  return {
    id: record.id,
    slug: record.slug,
    repositories: rows.map(coordinateOf).filter((coordinate): coordinate is string => coordinate !== null),
    paths: [resolved, ...repositories.map((repository) => repository.scanPath ?? repository.localPath)].filter(
      (path): path is string => typeof path === 'string' && path !== '',
    ),
    scanKeys: repositories.map((repository) => repository.scanKey).filter((key): key is string => key !== null),
  }
}

export async function loadProjectCatalog(
  db: Database,
  snapshot: Snapshot,
  config: Pick<PanelConfig, 'projectsHome' | 'gitDir' | 'gitStaleSeconds' | 'projectName'>,
): Promise<ProjectCatalog> {
  const [records, rows, manualLinks, remembered] = await Promise.all([
    db.projects.list(),
    db.repositories.list(),
    db.projects.listEnvironments(),
    rememberedEnvironments(db, snapshot, config),
  ])
  const projectsHome = config.projectsHome
  const scans = loadScans(config as PanelConfig)

  const rowsByProject = new Map<string, RepositoryRow[]>()
  for (const row of rows) rowsByProject.set(row.projectId, [...(rowsByProject.get(row.projectId) ?? []), row])

  const repositoriesByProject = new Map<string, Repository[]>()
  for (const record of records) {
    repositoriesByProject.set(
      record.id,
      (rowsByProject.get(record.id) ?? []).map((row) => toRepository(config as PanelConfig, row, scans)),
    )
  }

  const coordinates = records.map((record) =>
    coordinatesOf(record, rowsByProject.get(record.id) ?? [], repositoriesByProject.get(record.id) ?? [], projectsHome),
  )

  // A remembered Environment (containers gone, row kept) is still the
  // Project's: a manual link survives by construction, and a working
  // directory under the Project's paths adopts it the same way a live one is.
  const candidates = [...snapshot.environments, ...remembered]
  const manual = new Map(manualLinks.map((row) => [row.composeProject, row.projectId]))
  const adoptions = resolveAdoptions(candidates, coordinates, manual, {
    environmentKeys: scans.index?.environments ?? {},
  })

  const environments = new Map<string, ProjectEnvironment[]>()
  for (const environment of candidates) {
    const adoption = adoptions.get(environment.name)
    if (!adoption) continue
    const list = environments.get(adoption.projectId) ?? []
    list.push({
      environment: environment.name,
      source: adoption.source,
      attribution: 'resolved',
      running: environment.runningCount > 0,
      serviceCount: environment.serviceCount,
      runningCount: environment.runningCount,
      completedCount: environment.completedCount ?? 0,
      unhealthyCount: environment.unhealthyCount,
      urls: environment.urls,
    })
    environments.set(adoption.projectId, list)
  }

  return { records, repositoriesByProject, environments, projectsHome, scans }
}
