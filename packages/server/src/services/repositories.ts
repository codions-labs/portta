// A Repository as the API answers it: the registered decision joined with
// what the host scan observed.
//
// The join is by path, in four ways, in order: the registered local path is
// the scan's root; the registered path's key is in the index; the path it was
// registered at under Projects Home is a scanned root's; or, for a repository
// registered only by its GitHub name, a scanned root's remote has the same
// coordinate. Nothing here opens a project directory; it reads the
// files the collector wrote.

import type {
  DiscoveredRepository,
  ProjectGitHubRepository,
  Repository,
  RepositoryGit,
  RepositoryGitSummary,
} from 'portta-contracts'
import { repositoryKey } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { RepositoryRow } from '../db/repositories.ts'
import { repositoryCoordinate } from './adoption.ts'
import { readRepositoryScan, readScanIndex, type ScanIndex, type ScanIndexRepository } from './git.ts'
import type { Snapshot } from './inventory.ts'

export function toGitHubRepository(row: RepositoryRow): ProjectGitHubRepository | null {
  if (!row.github) return null
  return { slug: row.github.slug, htmlUrl: row.github.htmlUrl, role: row.role, position: row.position }
}

/** The coordinate (`owner/name`) a repository is matched on, from its remote. */
export function coordinateOf(row: Pick<RepositoryRow, 'remoteUrl' | 'github'>): string | null {
  return row.github?.slug.toLowerCase() ?? repositoryCoordinate(row.remoteUrl)
}

/** Which scanned root a registered repository corresponds to, if any. */
export function matchScan(
  row: Pick<RepositoryRow, 'localPath' | 'remoteUrl' | 'github'> & Partial<Pick<RepositoryRow, 'relativePath'>>,
  index: ScanIndex | null,
): ScanIndexRepository | null {
  if (!index) return null
  if (row.localPath) {
    const key = repositoryKey(row.localPath)
    const byPath = index.repositories.find((entry) => entry.key === key || entry.path === row.localPath)
    if (byPath) return byPath
  }
  // A repository placed under Projects Home by its relative path is the scanned
  // root at that same place; only the host knows the absolute path.
  if (row.relativePath) {
    const byRelative = index.repositories.find(
      (entry) => entry.location === 'managed' && entry.relativePath === row.relativePath,
    )
    if (byRelative) return byRelative
  }
  const coordinate = coordinateOf(row)
  if (coordinate) {
    const byRemote = index.repositories.filter((entry) => repositoryCoordinate(entry.remote) === coordinate)
    if (byRemote.length === 1) return byRemote[0]!
  }
  return null
}

export function gitSummaryOf(scan: RepositoryGit): RepositoryGitSummary | null {
  if (!scan.collected || !scan.git || scan.collectedAt === null) return null
  const { git } = scan
  return {
    branch: git.branch,
    detached: git.detached,
    head: git.head,
    dirty: git.dirty,
    changed: git.staged + git.unstaged + git.untracked + git.unmerged,
    ahead: git.ahead,
    behind: git.behind,
    base: git.upstream,
    collectedAt: scan.collectedAt,
    stale: scan.stale,
  }
}

export interface RepositoryScans {
  index: ScanIndex | null
  /** Scan key → the environments the index maps to it. */
  environmentsByKey: Map<string, string[]>
}

export function loadScans(config: PanelConfig): RepositoryScans {
  const index = readScanIndex(config)
  const environmentsByKey = new Map<string, string[]>()
  for (const [environment, key] of Object.entries(index?.environments ?? {})) {
    environmentsByKey.set(key, [...(environmentsByKey.get(key) ?? []), environment])
  }
  return { index, environmentsByKey }
}

/** One repository, assembled. Reads at most one scan file. */
export function toRepository(
  config: PanelConfig,
  row: RepositoryRow,
  scans: RepositoryScans,
  now = Date.now(),
): Repository {
  const matched = matchScan(row, scans.index)
  const scan = matched ? readRepositoryScan(config, matched.key, now) : null
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    role: row.role,
    provider: row.provider,
    localPath: row.localPath,
    relativePath: row.relativePath,
    remoteUrl: row.remoteUrl,
    position: row.position,
    scanKey: matched?.key ?? null,
    scanPath: matched?.path ?? null,
    git: scan ? gitSummaryOf(scan) : null,
    github: toGitHubRepository(row),
    environments: matched ? [...(scans.environmentsByKey.get(matched.key) ?? [])].sort() : [],
    instructionCount: scan?.instructions.length ?? 0,
  }
}

/** Scanned roots no registered repository matched, so the UI can offer them. */
export function discoveredRepositories(rows: readonly RepositoryRow[], scans: RepositoryScans): DiscoveredRepository[] {
  const claimed = new Set(
    rows
      .map((row) => matchScan(row, scans.index)?.key)
      .filter((key): key is string => key !== null && key !== undefined),
  )
  return (scans.index?.repositories ?? [])
    .filter((entry) => !claimed.has(entry.key))
    .map((entry) => ({
      key: entry.key,
      path: entry.path,
      name: entry.name,
      remote: entry.remote,
      location: entry.location,
      relativePath: entry.relativePath,
      environments: [...(scans.environmentsByKey.get(entry.key) ?? [])].sort(),
    }))
}

/** The environments the snapshot knows that run from one repository. */
export function environmentsOf(repository: Repository, snapshot: Snapshot) {
  return snapshot.environments
    .filter((environment) => repository.environments.includes(environment.name))
    .map((environment) => ({
      environment: environment.name,
      running: environment.runningCount > 0,
      serviceCount: environment.serviceCount,
      runningCount: environment.runningCount,
      completedCount: environment.completedCount ?? 0,
      unhealthyCount: environment.unhealthyCount,
      urls: environment.urls,
    }))
}
