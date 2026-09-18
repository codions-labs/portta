// What the host collects about a repository, and how it is keyed.
//
// The scan runs on the host (CLI / collector) and writes one file per
// repository under state/git, plus an index that maps environments to the
// repository they run from. The panel only reads the result. This module is
// the shape of that result and the pure helpers both sides share; the process
// execution stays in the CLI. See docs/development/adr/0032-portta-development-model.md,
// which amends ADR 0010: recent commits (metadata) and the content of the
// instruction files an agent reads are collected; a diff, an arbitrary file or
// a .env never is.

import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const SCAN_VERSION = 1
export const SCAN_INDEX_FILE = 'index.json'
export const RECENT_COMMITS = 20
export const INSTRUCTION_MAX_BYTES = 64 * 1024
export const REPOS_SCAN_INTERVAL_MS = 60_000

/**
 * Files an agent reads before it works. Exact paths, relative to the git root,
 * plus one bounded directory pattern. Nothing else is ever read: this is an
 * allowlist, not a search.
 */
export const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CONVENTIONS.md',
  '.clinerules',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
] as const

export const INSTRUCTION_DIRECTORIES = [{ directory: '.cursor/rules', extension: '.mdc' }] as const

/** Names that are never instruction files, whatever their location. */
const FORBIDDEN_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'])

/**
 * A path inside the repository, in one spelling, or null when it points
 * outside it or at a name that is never read. Every allowlist below starts
 * here, so the traversal and the forbidden names are refused once.
 */
function insideRepository(relativePath: string): string | null {
  const normalized = posix.normalize(relativePath).replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return null
  if (FORBIDDEN_NAMES.has(posix.basename(normalized))) return null
  return normalized
}

export function isInstructionPath(relativePath: string): boolean {
  const normalized = insideRepository(relativePath)
  if (normalized === null) return false
  if ((INSTRUCTION_FILES as readonly string[]).includes(normalized)) return true
  return INSTRUCTION_DIRECTORIES.some(({ directory, extension }) => {
    const prefix = `${directory}/`
    return (
      normalized.startsWith(prefix) && !normalized.slice(prefix.length).includes('/') && normalized.endsWith(extension)
    )
  })
}

/**
 * The documented intent a project already keeps — decision records and the
 * trees a Spec-Driven Development framework leaves — discovered the way the
 * instruction files are: by convention, from an allowlist, and never by
 * searching. Portta references these documents (path, hash, title) and reads
 * no content beyond the title line; the documents stay the project's
 * (docs/development/adr/0053-portta-is-spec-aware-not-spec-owned.md).
 *
 * `provider` names the convention a document was recognised by, `kind` what
 * it is within that convention. A `specs/` tree counts as Spec Kit only when
 * the `.specify/` marker exists; without it the tree is not attributed to
 * anything, because a wrong attribution is worse than none.
 */
export const SPECIFICATION_MAX_COUNT = 200
/** How much of a document is read to find its title. */
export const SPECIFICATION_TITLE_BYTES = 4 * 1024
/** Directory names that hold decision records, at the root or under `docs/` or `doc/`. */
export const DECISION_DIRECTORIES = ['adr', 'adrs', 'decisions', 'decision-records'] as const
/** Where the collector looks for the conventions above, and how deep it descends. */
export const SPECIFICATION_ROOTS = [
  { directory: 'docs', depth: 4 },
  { directory: 'doc', depth: 4 },
  ...DECISION_DIRECTORIES.map((directory) => ({ directory, depth: 1 })),
  { directory: 'openspec', depth: 5 },
  { directory: '.specify', depth: 3 },
  { directory: 'specs', depth: 2 },
] as const
/** The marker that makes a `specs/` tree a Spec Kit one. */
export const SPEC_KIT_MARKER = '.specify'

const NOT_A_DOCUMENT = new Set(['readme.md', 'index.md', 'template.md', 'changelog.md'])
const OPENSPEC_KINDS: Record<string, string> = {
  'proposal.md': 'change',
  'spec.md': 'specification',
  'design.md': 'design',
  'tasks.md': 'tasks',
}
const SPEC_KIT_KINDS: Record<string, string> = {
  'spec.md': 'specification',
  'plan.md': 'plan',
  'tasks.md': 'tasks',
  'research.md': 'research',
  'data-model.md': 'data-model',
  'quickstart.md': 'quickstart',
}

export interface SpecificationSource {
  /** The convention the document was recognised by: `adr`, `openspec` or `spec-kit`. */
  provider: string
  /** What it is within that convention: `decision`, `specification`, `change`, `plan`, … */
  kind: string
}

/** Which convention a path belongs to, or null when it is not a specification Portta recognises. */
export function specificationOf(relativePath: string, options: { specKit?: boolean } = {}): SpecificationSource | null {
  const normalized = insideRepository(relativePath)
  if (normalized === null) return null
  const segments = normalized.split('/')
  const name = segments.at(-1) ?? ''
  const lower = name.toLowerCase()
  if (!lower.endsWith('.md') || NOT_A_DOCUMENT.has(lower) || lower.startsWith('_')) return null
  const directories = segments.slice(0, -1)

  // Decision records: `<adr dir>/*.md` at the root, or under `docs/` or `doc/`
  // at a bounded depth. A README beside them is the index, not a decision.
  const parent = directories.at(-1)
  if (parent && (DECISION_DIRECTORIES as readonly string[]).includes(parent)) {
    const above = directories.slice(0, -1)
    const rooted = above.length === 0 || ((above[0] === 'docs' || above[0] === 'doc') && above.length <= 3)
    if (rooted) return { provider: 'adr', kind: 'decision' }
  }

  // OpenSpec: `openspec/project.md`, `openspec/specs/**/spec.md`, and the
  // documents of a change under `openspec/changes/<name>/`.
  if (directories[0] === 'openspec' && segments.length <= 6) {
    if (segments.length === 2 && lower === 'project.md') return { provider: 'openspec', kind: 'context' }
    const kind = OPENSPEC_KINDS[lower]
    if (kind && (directories[1] === 'specs' || directories[1] === 'changes')) return { provider: 'openspec', kind }
    return null
  }

  // Spec Kit: the constitution under `.specify/memory/`, and one feature
  // directory per `specs/<feature>/`, only beside the `.specify/` marker.
  if (options.specKit) {
    if (normalized === '.specify/memory/constitution.md') return { provider: 'spec-kit', kind: 'constitution' }
    if (directories.length === 2 && directories[0] === 'specs') {
      const kind = SPEC_KIT_KINDS[lower]
      if (kind) return { provider: 'spec-kit', kind }
    }
  }
  return null
}

/** The title of a document from its opening bytes: the first `#` heading, or a front matter `title:`. */
export function specificationTitle(head: string): string | null {
  const lines = head.split('\n')
  if (lines[0]?.trim() === '---') {
    for (const line of lines.slice(1)) {
      if (line.trim() === '---') break
      const match = /^title:\s*(.+?)\s*$/.exec(line)
      if (match?.[1]) return match[1].replace(/^["']|["']$/g, '')
    }
  }
  for (const line of lines) {
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

/** Which agent or convention a file speaks to; a hint for the UI, not a rule. */
export function instructionAudience(relativePath: string): string {
  const name = posix.basename(relativePath)
  if (name === 'AGENTS.md' || name === 'CONVENTIONS.md') return 'any'
  if (name === 'CLAUDE.md') return 'claude'
  if (name === 'GEMINI.md') return 'gemini'
  if (name === '.clinerules') return 'cline'
  if (name === '.windsurfrules') return 'windsurf'
  if (name === '.cursorrules' || relativePath.startsWith('.cursor/')) return 'cursor'
  if (relativePath.startsWith('.github/')) return 'copilot'
  return 'any'
}

/**
 * A stable, filename-safe key for a repository: twelve hex characters of the
 * realpath's SHA-1. Stable across scans and across renames of the Compose
 * project, which is the point of keying by repository rather than environment.
 */
export function repositoryKey(realpath: string): string {
  return createHash('sha1').update(normalizeRoot(realpath)).digest('hex').slice(0, 12)
}

/** What the panel accepts as a key: exactly what `repositoryKey` produces. */
export const REPOSITORY_KEY = /^[0-9a-f]{12}$/

function normalizeRoot(realpath: string): string {
  const normalized = posix.normalize(realpath).replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized
}

export interface CommitSummary {
  sha: string
  shortSha: string
  subject: string
  author: string
  email: string
  /** Unix seconds */
  date: number
}

/** `git log --format` producing one record per line, unit-separated. */
export const GIT_LOG_FORMAT = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%ct'

export function parseGitLog(raw: string, limit = RECENT_COMMITS): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const [sha = '', shortSha = '', subject = '', author = '', email = '', date = '0'] = line.split('\x1f')
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue
    commits.push({ sha, shortSha: shortSha || sha.slice(0, 7), subject, author, email, date: Number(date) || 0 })
    if (commits.length >= limit) break
  }
  return commits
}

export interface InstructionFile {
  /** Relative to the git root */
  path: string
  audience: string
  sizeBytes: number
  /** Unix seconds */
  modifiedAt: number
  sha256: string
  /** True when the working tree differs from HEAD for this file */
  dirty: boolean
  /** Present when the file fits INSTRUCTION_MAX_BYTES; otherwise null and `truncated` says so */
  content: string | null
  truncated: boolean
}

/**
 * A reference to one specification document, never its content: where it is,
 * which convention recognised it, what it is called, and the hash and dirty
 * flag that say which version is meant.
 */
export interface SpecificationReference {
  /** Relative to the git root */
  path: string
  provider: string
  kind: string
  /** The first heading or front matter title, when the document has one */
  title: string | null
  sizeBytes: number
  /** Unix seconds */
  modifiedAt: number
  sha256: string
  /** True when the working tree differs from HEAD for this file */
  dirty: boolean
}

export interface RepositoryGitSnapshot {
  branch: string | null
  detached: boolean
  head: { sha: string; shortSha: string; subject: string; author: string; date: number }
  staged: number
  unstaged: number
  untracked: number
  unmerged: number
  dirty: boolean
  upstream: string | null
  ahead: number
  behind: number
  remote: string | null
}

export interface RepositoryScan {
  version: number
  key: string
  /** realpath of the git root */
  path: string
  name: string
  collectedAt: number
  git: RepositoryGitSnapshot | null
  reason: string | null
  commits: CommitSummary[]
  instructions: InstructionFile[]
  /** Decision records and specification trees the project keeps, as references; absent in files older than this field */
  specifications?: SpecificationReference[]
  /** COMPOSE_PROJECT_NAMEs whose working directory sits under this root */
  environments: string[]
  forge?: Record<string, unknown> | null
}

export interface ScanIndexEntry {
  key: string
  path: string
  name: string
  remote: string | null
  /** Where the root sits relative to Projects Home, when a Home is configured */
  location: 'managed' | 'external' | 'escaped' | 'missing' | 'inaccessible' | null
  /** Path relative to Projects Home, one or two segments (a workspace directory may hold repositories), null outside it */
  relativePath: string | null
}

export interface ScanIndex {
  version: number
  collectedAt: number
  home: string | null
  repositories: ScanIndexEntry[]
  /** COMPOSE_PROJECT_NAME → repository key */
  environments: Record<string, string>
}

/** A repository's display name: the root's basename. */
export function repositoryName(realpath: string): string {
  return posix.basename(normalizeRoot(realpath)) || realpath
}
