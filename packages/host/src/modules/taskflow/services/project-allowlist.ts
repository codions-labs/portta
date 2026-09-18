import { homedir } from 'node:os'
import { canonicalizeFsPath } from '../adapters/git.ts'

export class ProjectAllowlistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectAllowlistError'
  }
}

const SPEC_SPLIT = /[:;,]/

/** Parse `PORTTA_FLOW_PROJECT_ALLOWLIST` (colon/comma/semicolon-separated). An empty
 *  spec falls back to `fallbackRoots` (default: the operator's home directory).
 *  Roots are canonicalized so symlink aliases cannot widen the set. */
export function loadProjectAllowlist(options: { spec?: string | undefined; fallbackRoots?: string[] } = {}): string[] {
  const fallback = options.fallbackRoots ?? [homedir()]
  const parsed = (options.spec ?? '')
    .split(SPEC_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const roots = parsed.length > 0 ? parsed : fallback
  return [...new Set(roots.map((root) => canonicalizeFsPath(root)))]
}

export function isPathInsideAllowlist(candidate: string, allowlist: string[]): boolean {
  const resolved = canonicalizeFsPath(candidate)
  return allowlist.some((root) => {
    const canonicalRoot = canonicalizeFsPath(root)
    if (resolved === canonicalRoot) return true
    const prefix = canonicalRoot.endsWith('/') ? canonicalRoot : `${canonicalRoot}/`
    return resolved.startsWith(prefix)
  })
}

/** Canonicalize `candidate` and refuse it when it is not a member of the
 *  allowlist (including after symlink resolution / `..` traversal). */
export function assertProjectRootAllowed(candidate: string, allowlist: string[]): string {
  const resolved = canonicalizeFsPath(candidate)
  if (!isPathInsideAllowlist(resolved, allowlist)) {
    throw new ProjectAllowlistError(`Project root is outside the configured allowlist: ${resolved}`)
  }
  return resolved
}

export interface ProjectRegistrationDeps {
  isGitRepo: (path: string) => boolean
  resolveRoot: (path: string) => string
  allowlist: string[]
}

/**
 * Resolve a user-supplied path to a canonical git root that may be registered.
 * Does not write into the repository and does not spawn an agent or workflow.
 */
export function registerableProjectRoot(inputPath: string, deps: ProjectRegistrationDeps): string {
  const trimmed = inputPath.trim()
  if (!trimmed) throw new Error('Project path is required')
  if (!deps.isGitRepo(trimmed)) throw new Error(`Not a git repository: ${trimmed}`)
  const root = canonicalizeFsPath(deps.resolveRoot(trimmed))
  return assertProjectRootAllowed(root, deps.allowlist)
}
