// Reading what `portta repos scan` collected on the host.
//
// The panel has no access to any project directory and runs no shell commands.
// It reads one file per repository from a read-only mount (an index maps each
// environment to the repository it runs from), and reports how old it is: what is on screen is as true as the last scan, and the UI says so rather
// than implying currency. See docs/development/adr/0010-git-collected-on-the-host.md.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Commit,
  ForgePullRequest,
  GitInfo,
  InstructionFile,
  ProjectGit,
  ProjectLocation,
  RepositoryGit,
  SpecificationReference,
} from 'portta-contracts'
import { branchUrl, commitUrl, parseRemote } from 'portta-core'
import type { PanelConfig } from '../config.ts'

/** Compose project names Docker itself allows, and nothing that walks a path. */
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The collector writes this file, but it lands on a mount, so it is read as
 * untrusted input: every field is coerced, and a shape that does not fit is a
 * project with no Git rather than a 500.
 */
function toGitInfo(raw: unknown): GitInfo | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const head = (value.head ?? {}) as Record<string, unknown>

  return {
    branch: asOptionalString(value.branch),
    detached: value.detached === true,
    head: {
      sha: asString(head.sha),
      shortSha: asString(head.shortSha),
      subject: asString(head.subject),
      author: asString(head.author),
      date: asNumber(head.date),
    },
    staged: asNumber(value.staged),
    unstaged: asNumber(value.unstaged),
    untracked: asNumber(value.untracked),
    unmerged: asNumber(value.unmerged),
    dirty: value.dirty === true,
    upstream: asOptionalString(value.upstream),
    ahead: asNumber(value.ahead),
    behind: asNumber(value.behind),
    remote: asOptionalString(value.remote),
  }
}

function toPullRequests(raw: unknown): ForgePullRequest[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 20).map((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>
    return {
      number: asNumber(value.number),
      title: asString(value.title),
      state: asString(value.state) || 'OPEN',
      draft: value.draft === true,
      reviewDecision: asOptionalString(value.reviewDecision),
      checks: asOptionalString(value.checks),
      url: asOptionalString(value.url),
      headRefName: asOptionalString(value.headRefName),
    }
  })
}

/** Only what `repositoryKey` produces: twelve hex characters, nothing that walks a path. */
const REPOSITORY_KEY = /^[0-9a-f]{12}$/

export interface ScanIndexRepository {
  key: string
  path: string
  name: string
  remote: string | null
  location: ProjectLocation | null
  relativePath: string | null
}

export interface ScanIndex {
  collectedAt: number
  home: string | null
  repositories: ScanIndexRepository[]
  /** COMPOSE_PROJECT_NAME → repository key */
  environments: Record<string, string>
}

const LOCATIONS = new Set(['managed', 'external', 'escaped', 'missing', 'inaccessible'])

/**
 * The scan index: which repositories the host found and which one each
 * environment runs from. Read on every call and never cached, because it is
 * small and the collector rewrites it once a minute; a missing or malformed
 * index is simply "no mapping".
 */
export function readScanIndex(config: PanelConfig): ScanIndex | null {
  const path = join(config.gitDir, 'index.json')
  if (!existsSync(path)) return null
  try {
    if (statSync(path).size > 512 * 1024) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const raw = (parsed.environments ?? {}) as Record<string, unknown>
    const environments: Record<string, string> = {}
    for (const [environment, key] of Object.entries(raw)) {
      if (PROJECT_NAME.test(environment) && typeof key === 'string' && REPOSITORY_KEY.test(key))
        environments[environment] = key
    }
    const repositories: ScanIndexRepository[] = []
    for (const entry of Array.isArray(parsed.repositories) ? parsed.repositories : []) {
      const value = (entry ?? {}) as Record<string, unknown>
      const key = asString(value.key)
      const repositoryPath = asString(value.path)
      if (!REPOSITORY_KEY.test(key) || !repositoryPath.startsWith('/')) continue
      const location = asOptionalString(value.location)
      repositories.push({
        key,
        path: repositoryPath,
        name: asString(value.name) || repositoryPath.split('/').filter(Boolean).at(-1) || repositoryPath,
        remote: asOptionalString(value.remote),
        location: location && LOCATIONS.has(location) ? (location as ProjectLocation) : null,
        relativePath: asOptionalString(value.relativePath),
      })
    }
    return {
      environments,
      repositories,
      home: asOptionalString(parsed.home),
      collectedAt: asNumber(parsed.collectedAt),
    }
  } catch {
    return null
  }
}

/** The collected file for an environment, resolved through the scan index. */
export function gitFileFor(config: PanelConfig, project: string): string | null {
  if (!PROJECT_NAME.test(project)) return null
  const key = readScanIndex(config)?.environments[project]
  return key ? join(config.gitDir, `${key}.json`) : null
}

/**
 * What the panel knows about one project's repository, or the honest absence
 * of it. Never throws: an unreadable or malformed file is reported as not
 * collected, with the command that would fix it.
 */
export function readProjectGit(config: PanelConfig, project: string, now = Date.now()): ProjectGit {
  const refreshCommand = `./bin/portta repos scan --environment ${project}`
  const absent: ProjectGit = {
    project,
    collected: false,
    collectedAt: null,
    ageSeconds: null,
    stale: false,
    staleAfterSeconds: config.gitStaleSeconds,
    workingDir: null,
    git: null,
    remote: null,
    links: { repo: null, commit: null, branch: null },
    forge: null,
    reason: null,
    refreshCommand,
  }

  const file = gitFileFor(config, project)
  if (file === null || !existsSync(file)) return absent

  let parsed: Record<string, unknown>
  try {
    // Bounded: this is a metadata file, and anything large is not one.
    if (statSync(file).size > 512 * 1024) {
      return { ...absent, reason: 'the collected file is implausibly large and was not read' }
    }
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return { ...absent, reason: 'the collected file could not be read' }
  }

  const collectedAt = asNumber(parsed.collectedAt)
  const ageSeconds = collectedAt > 0 ? Math.max(0, Math.floor(now / 1000) - collectedAt) : null
  const git = toGitInfo(parsed.git)
  const remote = git?.remote ? parseRemote(git.remote) : null
  const forgeRaw = (parsed.forge ?? null) as Record<string, unknown> | null

  return {
    project,
    collected: true,
    collectedAt: collectedAt > 0 ? collectedAt : null,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds > config.gitStaleSeconds,
    staleAfterSeconds: config.gitStaleSeconds,
    workingDir: asOptionalString(parsed.workingDir) ?? asOptionalString(parsed.path),
    git,
    remote: remote
      ? { url: remote.url, host: remote.host, slug: remote.slug, kind: remote.kind, repoUrl: remote.repoUrl }
      : null,
    links: {
      repo: remote?.repoUrl ?? null,
      commit: remote && git ? commitUrl(remote, git.head.sha) : null,
      branch: remote && git?.branch ? branchUrl(remote, git.branch) : null,
    },
    forge: forgeRaw
      ? {
          kind: asString(forgeRaw.kind) || 'github',
          collectedAt: asNumber(forgeRaw.collectedAt) || collectedAt,
          authenticated: forgeRaw.authenticated !== false,
          reason: asOptionalString(forgeRaw.reason),
          pulls: toPullRequests(forgeRaw.pulls),
        }
      : null,
    reason: asOptionalString(parsed.reason),
    refreshCommand,
  }
}

function toCommits(raw: unknown, remote: ReturnType<typeof parseRemote> | null): Commit[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 50).flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>
    const sha = asString(value.sha)
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return []
    return [
      {
        sha,
        shortSha: asString(value.shortSha) || sha.slice(0, 7),
        subject: asString(value.subject),
        author: asString(value.author),
        date: asNumber(value.date),
        url: remote ? commitUrl(remote, sha) : null,
      },
    ]
  })
}

function toInstructions(raw: unknown): InstructionFile[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 50).flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>
    const path = asString(value.path)
    if (path === '' || path.startsWith('/') || path.split('/').includes('..')) return []
    return [
      {
        path,
        audience: asString(value.audience) || 'any',
        sizeBytes: asNumber(value.sizeBytes),
        modifiedAt: asNumber(value.modifiedAt),
        sha256: asString(value.sha256),
        dirty: value.dirty === true,
        content: typeof value.content === 'string' ? value.content : null,
        truncated: value.truncated === true,
      },
    ]
  })
}

function toSpecifications(raw: unknown): SpecificationReference[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).flatMap((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>
    const path = asString(value.path)
    if (path === '' || path.startsWith('/') || path.split('/').includes('..')) return []
    return [
      {
        path,
        provider: asString(value.provider) || 'unknown',
        kind: asString(value.kind) || 'document',
        title: asOptionalString(value.title),
        sizeBytes: asNumber(value.sizeBytes),
        modifiedAt: asNumber(value.modifiedAt),
        sha256: asString(value.sha256),
        dirty: value.dirty === true,
      },
    ]
  })
}

/**
 * Everything the host collected about one repository, or the honest absence
 * of it. Same discipline as `readProjectGit`: the file is untrusted input,
 * every field is coerced, and nothing here throws.
 */
export function readRepositoryScan(config: PanelConfig, key: string, now = Date.now()): RepositoryGit {
  const refreshCommand = './bin/portta repos scan'
  const absent: RepositoryGit = {
    key,
    collected: false,
    collectedAt: null,
    ageSeconds: null,
    stale: false,
    staleAfterSeconds: config.gitStaleSeconds,
    path: null,
    name: null,
    git: null,
    remote: null,
    links: { repo: null, commit: null, branch: null },
    commits: [],
    instructions: [],
    specifications: [],
    environments: [],
    forge: null,
    reason: null,
    refreshCommand,
  }
  if (!REPOSITORY_KEY.test(key)) return absent
  const file = join(config.gitDir, `${key}.json`)
  if (!existsSync(file)) return absent

  let parsed: Record<string, unknown>
  try {
    // Instruction files are bounded at 64 KiB each and there are few of them;
    // anything past a few megabytes is not a scan file.
    if (statSync(file).size > 4 * 1024 * 1024) {
      return { ...absent, reason: 'the collected file is implausibly large and was not read' }
    }
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return { ...absent, reason: 'the collected file could not be read' }
  }

  const collectedAt = asNumber(parsed.collectedAt)
  const ageSeconds = collectedAt > 0 ? Math.max(0, Math.floor(now / 1000) - collectedAt) : null
  const git = toGitInfo(parsed.git)
  const remote = git?.remote ? parseRemote(git.remote) : null
  const forgeRaw = (parsed.forge ?? null) as Record<string, unknown> | null
  const path = asOptionalString(parsed.path) ?? asOptionalString(parsed.workingDir)
  const environments = Array.isArray(parsed.environments)
    ? parsed.environments.filter((entry): entry is string => typeof entry === 'string' && PROJECT_NAME.test(entry))
    : []

  return {
    key,
    collected: true,
    collectedAt: collectedAt > 0 ? collectedAt : null,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds > config.gitStaleSeconds,
    staleAfterSeconds: config.gitStaleSeconds,
    path,
    name: asOptionalString(parsed.name) ?? (path ? (path.split('/').filter(Boolean).at(-1) ?? null) : null),
    git,
    remote: remote
      ? { url: remote.url, host: remote.host, slug: remote.slug, kind: remote.kind, repoUrl: remote.repoUrl }
      : null,
    links: {
      repo: remote?.repoUrl ?? null,
      commit: remote && git ? commitUrl(remote, git.head.sha) : null,
      branch: remote && git?.branch ? branchUrl(remote, git.branch) : null,
    },
    commits: toCommits(parsed.commits, remote),
    instructions: toInstructions(parsed.instructions),
    specifications: toSpecifications(parsed.specifications),
    environments,
    forge: forgeRaw
      ? {
          kind: asString(forgeRaw.kind) || 'github',
          collectedAt: asNumber(forgeRaw.collectedAt) || collectedAt,
          authenticated: forgeRaw.authenticated !== false,
          reason: asOptionalString(forgeRaw.reason),
          pulls: toPullRequests(forgeRaw.pulls),
        }
      : null,
    reason: asOptionalString(parsed.reason),
    refreshCommand: path ? `./bin/portta repos scan --path ${path}` : refreshCommand,
  }
}
