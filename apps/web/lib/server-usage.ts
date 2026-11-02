// How much of the server a reading is, and whose it is.
//
// The server's own reading says how much is in use; the projects' readings say how
// much of that is theirs. What is left over belongs to the operating system and
// whatever else runs there, which is the part that was invisible before.

import type { DockerStorageInfo, HostMetrics, ProjectResourceMetrics } from 'portta-contracts'

export type UsageKind = 'memory' | 'cpu' | 'disk' | 'gpu'

export interface ProjectShare {
  /** The compose project, which is what the environment page is addressed by. */
  environment: string
  name: string
  /** Bytes, or cores for the processor. */
  value: number
  /** Of the whole server, 0-1. */
  share: number
}

export interface UsageSplit {
  kind: UsageKind
  /** Bytes, or cores for the processor. */
  total: number
  used: number
  free: number
  /** Null when this resource is not measured per project (the disk, for now). */
  projects: number | null
  portta: number | null
  system: number | null
  /** Largest first. */
  shares: ProjectShare[]
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function usedBy(kind: 'memory' | 'cpu' | 'gpu', project: ProjectResourceMetrics): number {
  const value =
    kind === 'memory' ? project.memoryUsedBytes : kind === 'gpu' ? project.gpuMemoryBytes : project.cpuUtilisation
  return finite(value) && value > 0 ? value : 0
}

function diskSplit(
  host: HostMetrics,
  projects: readonly ProjectResourceMetrics[],
  storage: DockerStorageInfo | null | undefined,
): UsageSplit | null {
  if (!host.storage) return null
  const { totalBytes, usedBytes } = host.storage
  const used = Math.min(totalBytes, Math.max(0, usedBytes))
  const base = { kind: 'disk' as const, total: totalBytes, used, free: totalBytes - used }
  // Without a reading of the Docker disk the whole disk is all that can be said.
  if (!storage) return { ...base, projects: null, portta: null, system: null, shares: [] }

  const own = new Set(projects.filter((project) => project.own).map((project) => project.composeProject))
  const names = new Map(projects.map((project) => [project.composeProject, project.name]))
  let mine = 0
  let ours = 0
  const shares: ProjectShare[] = []
  for (const entry of storage.projects) {
    const value = entry.volumeBytes + entry.layerBytes
    if (own.has(entry.composeProject)) {
      ours += value
      continue
    }
    mine += value
    if (value > 0) {
      shares.push({
        environment: entry.composeProject,
        name: names.get(entry.composeProject) ?? entry.composeProject,
        value,
        share: value / totalBytes,
      })
    }
  }
  const scale = mine + ours > used && mine + ours > 0 ? used / (mine + ours) : 1
  return {
    ...base,
    projects: mine * scale,
    portta: ours * scale,
    system: Math.max(0, used - (mine + ours) * scale),
    shares: shares.sort((a, b) => b.value - a.value),
  }
}

/** The split of one resource, or null when the server does not report its total. */
export function usageSplit(
  kind: UsageKind,
  host: HostMetrics,
  projects: readonly ProjectResourceMetrics[],
  storage?: DockerStorageInfo | null,
): UsageSplit | null {
  if (kind === 'disk') return diskSplit(host, projects, storage)

  const total =
    kind === 'memory'
      ? host.memoryTotalBytes
      : kind === 'gpu'
        ? (host.gpuMemory?.totalBytes ?? null)
        : host.cpu.logicalCores
  const rawUsed =
    kind === 'memory'
      ? host.memoryUsedBytes
      : kind === 'gpu'
        ? (host.gpuMemory?.usedBytes ?? null)
        : finite(host.cpuUtilisation) && total
          ? host.cpuUtilisation * total
          : null
  if (!finite(total) || total <= 0 || !finite(rawUsed)) return null
  const used = Math.min(total, Math.max(0, rawUsed))

  let mine = 0
  let ours = 0
  const shares: ProjectShare[] = []
  for (const project of projects) {
    const value = usedBy(kind, project)
    if (project.own) {
      ours += value
      continue
    }
    mine += value
    if (value > 0) {
      shares.push({ environment: project.composeProject, name: project.name, value, share: value / total })
    }
  }
  // Containers are read at slightly different moments than the server, so their
  // sum can pass what the server said; the server's number is the one that is whole.
  const scale = mine + ours > used && mine + ours > 0 ? used / (mine + ours) : 1
  const projectsPart = mine * scale
  const ourPart = ours * scale
  return {
    kind,
    total,
    used,
    free: total - used,
    projects: projectsPart,
    portta: ourPart,
    system: Math.max(0, used - projectsPart - ourPart),
    shares: shares.sort((a, b) => b.value - a.value),
  }
}

/** The projects' share of what is in use, 0-1; null when it cannot be said. */
export function projectsOfUsed(split: UsageSplit): number | null {
  if (split.projects === null || split.used <= 0) return null
  return split.projects / split.used
}
