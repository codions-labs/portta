// `portta projects resolve --path <abs>`: which Project a directory belongs to.
//
// A tool that is already inside a project directory (an agent, a script, an
// editor) has no slug to hand over, and the directory's name is not the
// identity: a worktree is not even named after its project. Resolution reads
// the host (realpath, git) here, where the filesystem is, and the panel's
// registry over the API, where the decisions are. A Project is a directory
// under Projects Home, so the answer is the Project whose directory is the
// path, contains it, or is the main checkout behind a linked worktree. It
// writes nothing anywhere, and when it cannot answer it says which reason
// applies rather than guess.

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import type { PanelClient } from '../api.js'
import { segment } from '../api.js'
import { CliError, EXIT, UsageError } from '../errors.js'
import type { Output } from '../output.js'
import { runProcess } from '../process.js'
import { clientFor } from './work.js'

/** How the answer was reached, from the most to the least certain. */
export type ResolveBasis = 'root' | 'subdirectory' | 'worktree'

export interface ResolvedProject {
  resolved: true
  path: string
  basis: ResolveBasis
  project: { id: string; slug: string; name: string; path: string }
  /** Present when the path is a linked worktree of the Project's checkout. */
  worktree: { path: string; mainPath: string } | null
}

export type ResolveFailureKind = 'unknown' | 'ambiguous' | 'unauthorized'

export interface ResolveFailure {
  resolved: false
  path: string
  error: {
    kind: ResolveFailureKind
    message: string
    hint: string | null
    /** The Projects that could each have answered, when the failure is ambiguity. */
    candidates: Array<{ slug: string; path: string; basis: ResolveBasis }>
  }
}

export type ResolveOutcome = ResolvedProject | ResolveFailure

interface RegisteredProject {
  id: string
  slug: string
  name: string
  resolvedPath: string | null
}

interface PathFacts {
  path: string
  gitRoot: string | null
  commonRoot: string | null
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  const result = await runProcess('git', ['-C', cwd, ...args], { reject: false })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

/** What the host knows about a directory: its git root and the main checkout behind a worktree. */
export async function pathFacts(path: string): Promise<PathFacts> {
  const top = await git(path, ['rev-parse', '--show-toplevel'])
  const gitRoot = top ? safeRealpath(top) : null
  let commonRoot: string | null = null
  if (gitRoot) {
    const common = await git(path, ['rev-parse', '--git-common-dir'])
    // `--git-common-dir` is `.git` for a main checkout and the main checkout's
    // `.git` for a linked worktree; either way its parent is the main root.
    if (common) commonRoot = safeRealpath(resolve(path, common, '..'))
  }
  return { path, gitRoot, commonRoot }
}

function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function basisOf(facts: PathFacts, projectPath: string): ResolveBasis | null {
  if (facts.path === projectPath) return 'root'
  if (inside(facts.path, projectPath)) return 'subdirectory'
  if (facts.commonRoot === projectPath && facts.gitRoot !== projectPath) return 'worktree'
  return null
}

/** The registry: every Project the caller may see, with the directory the panel resolved for it. */
export async function registeredProjects(client: PanelClient): Promise<RegisteredProject[]> {
  const list = await client.request<{ projects: Array<{ slug: string }> }>('GET', '/projects')
  return Promise.all(
    list.projects.map((summary) => client.request<RegisteredProject>('GET', `/projects/${segment(summary.slug)}`)),
  )
}

/** Resolve a directory to the Project that owns it. Reads the host and the panel; writes nothing. */
export async function resolvePath(rawPath: string, client: PanelClient): Promise<ResolveOutcome> {
  const absolute = resolve(rawPath)
  const real = safeRealpath(absolute)
  if (!real)
    throw new UsageError(`${absolute} does not exist on this host`, 'pass an absolute path to a directory that exists')
  const facts = await pathFacts(real)

  let projects: RegisteredProject[]
  try {
    projects = await registeredProjects(client)
  } catch (error) {
    if (error instanceof CliError && error.exitCode === EXIT.refused) {
      return failure(
        real,
        'unauthorized',
        error.message,
        error.hint ?? 'sign in with `portta auth login`, or ask for access to the Project',
        [],
      )
    }
    throw error
  }

  const matches: Array<{ project: RegisteredProject; path: string; basis: ResolveBasis }> = []
  for (const project of projects) {
    const path = project.resolvedPath ? safeRealpath(project.resolvedPath) : null
    if (!path) continue
    const basis = basisOf(facts, path)
    if (basis) matches.push({ project, path, basis })
  }

  if (matches.length === 0) {
    return failure(
      real,
      'unknown',
      `${real} belongs to no Project the panel knows`,
      'create the Project with `portta projects create --path <dir>`, or check `portta projects list`',
      [],
    )
  }

  // Projects can nest (`group/app` inside `group`): the deepest directory is
  // the most specific answer, and only a tie is ambiguous.
  const depth = Math.max(...matches.map((match) => match.path.length))
  const closest = matches.filter((match) => match.path.length === depth)
  if (closest.length > 1) {
    return failure(
      real,
      'ambiguous',
      `${real} could belong to ${closest.map((match) => match.project.slug).join(' or ')}; nothing was chosen`,
      'name the Project explicitly, or fix the duplicate directory in the panel',
      closest.map((match) => ({ slug: match.project.slug, path: match.path, basis: match.basis })),
    )
  }

  const match = closest[0]!
  return {
    resolved: true,
    path: real,
    basis: match.basis,
    project: { id: match.project.id, slug: match.project.slug, name: match.project.name, path: match.path },
    worktree:
      match.basis === 'worktree' && facts.gitRoot && facts.commonRoot
        ? { path: facts.gitRoot, mainPath: facts.commonRoot }
        : null,
  }
}

function failure(
  path: string,
  kind: ResolveFailureKind,
  message: string,
  hint: string | null,
  candidates: ResolveFailure['error']['candidates'],
): ResolveFailure {
  return { resolved: false, path, error: { kind, message, hint, candidates } }
}

const EXIT_BY_KIND: Record<ResolveFailureKind, number> = {
  unknown: EXIT.failure,
  ambiguous: EXIT.failure,
  unauthorized: EXIT.refused,
}

/** Print an outcome the way the caller asked, and set the exit code a failure deserves. */
export function reportOutcome(output: Output, outcome: ResolveOutcome): void {
  if (output.json) {
    output.data(outcome)
    if (!outcome.resolved) process.exitCode = EXIT_BY_KIND[outcome.error.kind]
    return
  }
  if (!outcome.resolved) {
    output.error(`${outcome.error.kind}: ${outcome.error.message}`)
    for (const candidate of outcome.error.candidates)
      output.line(`  ${candidate.slug.padEnd(20)} ${candidate.path}  [${candidate.basis}]`)
    if (outcome.error.hint) output.hint(outcome.error.hint)
    process.exitCode = EXIT_BY_KIND[outcome.error.kind]
    return
  }
  output.line(`${outcome.project.name} (${outcome.project.slug}) · by ${outcome.basis}`)
  if (outcome.worktree) output.line(`  worktree of ${outcome.worktree.mainPath}`)
  output.line(`  path ${outcome.project.path}`)
}

export async function projectsResolve(options: { path?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const outcome = await resolvePath(options.path ?? process.cwd(), client)
  reportOutcome(output, outcome)
}
