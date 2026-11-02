// Assemble a Project from the persisted grouping plus the live Environment
// snapshot. See docs/development/adr/0031-projects-home-and-project.md.

import type { Project, ProjectEnvironment, ProjectLocation, ProjectSummary } from 'portta-contracts'
import { resolveProjectPath } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { ProjectRecord } from '../db/projects.ts'
import { resolveAdoptions } from './adoption.ts'
import type { Snapshot } from './inventory.ts'
import { rememberedEnvironments } from './remembered.ts'

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

export function toProjectSummary(record: ProjectRecord, adopted: ProjectEnvironment[]): ProjectSummary {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    archived: record.archived,
    relativePath: record.relativePath,
    location: projectLocationOf(record.relativePath),
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

export function toProject(record: ProjectRecord, adopted: ProjectEnvironment[], projectsHome: string | null): Project {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    archived: record.archived,
    relativePath: record.relativePath,
    resolvedPath: resolvedPathOf(projectsHome, record.relativePath),
    location: projectLocationOf(record.relativePath),
    environments: adopted,
  }
}

export interface ProjectCatalog {
  records: ProjectRecord[]
  environments: Map<string, ProjectEnvironment[]>
  projectsHome: string | null
}

export async function loadProjectCatalog(
  db: Database,
  snapshot: Snapshot,
  config: Pick<PanelConfig, 'projectsHome' | 'projectName'>,
): Promise<ProjectCatalog> {
  const [records, manualLinks, remembered] = await Promise.all([
    db.projects.list(),
    db.projects.listEnvironments(),
    rememberedEnvironments(db, snapshot, config),
  ])
  const projectsHome = config.projectsHome

  const coordinates = records.map((record) => ({
    id: record.id,
    slug: record.slug,
    path: resolvedPathOf(projectsHome, record.relativePath),
  }))

  // A remembered Environment (containers gone, row kept) is still the
  // Project's: a manual link survives by construction, and a working
  // directory under the Project's path adopts it the same way a live one is.
  const candidates = [...snapshot.environments, ...remembered]
  const manual = new Map(manualLinks.map((row) => [row.composeProject, row.projectId]))
  const adoptions = resolveAdoptions(candidates, coordinates, manual)

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

  return { records, environments, projectsHome }
}
