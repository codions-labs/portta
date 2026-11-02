// What each Compose project keeps on the Docker disk, from `docker system df -v`.
//
// Only what belongs to one project for certain is counted: its named volumes and the
// writable layer of each of its containers. Images are shared between projects and
// are left with the rest of the system, and so are the files in a project's folder.

import { composeProjectOf, parseDockerSize } from './metrics.ts'

export interface ProjectStorage {
  composeProject: string
  volumeBytes: number
  layerBytes: number
}

export interface DockerStorage {
  collectedAt: number
  projects: ProjectStorage[]
}

/** `docker system df` sizes: "418MB", and for a container "0B (virtual 1.2GB)", of which only the first is its own. */
export function parseDfSize(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const size = parseDockerSize(value.split('(')[0])
  return size === null ? null : Math.round(size)
}

/** Docker prints labels as `a=b,c=d`; only the Compose project is read from them. */
function projectOf(labels: unknown): string | null {
  if (typeof labels !== 'string' || labels === '') return null
  const parsed: Record<string, string> = {}
  for (const pair of labels.split(',')) {
    const at = pair.indexOf('=')
    if (at > 0) parsed[pair.slice(0, at)] = pair.slice(at + 1)
  }
  return composeProjectOf(parsed)
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    : []
}

export function parseDockerStorage(output: string, collectedAt: number): DockerStorage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { Volumes, Containers } = parsed as Record<string, unknown>
  const projects = new Map<string, ProjectStorage>()
  const entry = (composeProject: string) => {
    const existing = projects.get(composeProject) ?? { composeProject, volumeBytes: 0, layerBytes: 0 }
    projects.set(composeProject, existing)
    return existing
  }
  for (const volume of rows(Volumes)) {
    const project = projectOf(volume.Labels)
    const size = parseDfSize(volume.Size)
    if (project && size !== null) entry(project).volumeBytes += size
  }
  for (const container of rows(Containers)) {
    const project = projectOf(container.Labels)
    const size = parseDfSize(container.Size)
    if (project && size !== null) entry(project).layerBytes += size
  }
  return {
    collectedAt,
    projects: [...projects.values()].sort((a, b) => b.volumeBytes + b.layerBytes - (a.volumeBytes + a.layerBytes)),
  }
}
