// `portta projects resolve --path <abs>`: which Project a directory belongs to.
//
// A tool that is already inside a repository — an agent, a script, an editor —
// has no slug to hand over, and the directory's name is not the identity: a
// worktree is not even named after its repository. Resolution reads the host
// (realpath, git) here, where the filesystem is, and the panel's registry over
// the API, where the decisions are. It writes nothing anywhere, and when it
// cannot answer it says which of the four reasons applies rather than guess.

import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { parseRemote } from 'portta-core'
import type { PanelClient } from '../api.js'
import { segment } from '../api.js'
import { CliError, EXIT, UsageError } from '../errors.js'
import type { Output } from '../output.js'
import { runProcess } from '../process.js'
import { clientFor } from './work.js'

/** How the answer was reached, from the most to the least certain. */
export type ResolveBasis = 'root' | 'subdirectory' | 'worktree' | 'remote'

export interface ResolvedProject {
  resolved: true
  path: string
  basis: ResolveBasis
  /** False when only the remote matched: the path itself is unknown to the panel. */
  certain: boolean
  project: { id: string; slug: string; name: string }
  repository: { id: string; name: string; path: string | null; remoteUrl: string | null }
  git: { root: string | null; branch: string | null; remote: string | null }
  /** Present when the path is a linked worktree of the registered repository. */
  worktree: { path: string; mainPath: string } | null
}

export type ResolveFailureKind = 'unknown' | 'ambiguous' | 'stale' | 'unauthorized'

export interface ResolveFailure {
  resolved: false
  path: string
  error: {
    kind: ResolveFailureKind
    message: string
    hint: string | null
    /** The Projects that could each have answered, when the failure is ambiguity or staleness. */
    candidates: Array<{ slug: string; repository: string; path: string | null; basis: ResolveBasis }>
  }
}

export type ResolveOutcome = ResolvedProject | ResolveFailure

interface RegisteredRepository {
  id: string
  name: string
  localPath: string | null
  relativePath: string | null
  remoteUrl: string | null
  scanPath: string | null
}

interface RegisteredProject {
  id: string
  slug: string
  name: string
  resolvedPath: string | null
  repositories: RegisteredRepository[]
}

interface Candidate {
  project: RegisteredProject
  repository: RegisteredRepository
  path: string | null
  exists: boolean
}

interface PathFacts {
  path: string
  gitRoot: string | null
  commonRoot: string | null
  branch: string | null
  remote: string | null
}

const BASIS_ORDER: ResolveBasis[] = ['root', 'subdirectory', 'worktree', 'remote']

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

/** What the host knows about a directory: its git root, the main checkout behind a worktree, the branch and the remote. */
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
  const branch = gitRoot ? await git(path, ['rev-parse', '--abbrev-ref', 'HEAD']) : null
  const remote = gitRoot ? await git(path, ['config', '--get', 'remote.origin.url']) : null
  return { path, gitRoot, commonRoot, branch: branch === 'HEAD' ? null : branch, remote }
}

/** A remote in one spelling, so `git@github.com:o/r.git` and `https://github.com/o/r` compare equal. */
function remoteKey(raw: string | null): string | null {
  if (!raw) return null
  const parsed = parseRemote(raw)
  return parsed ? `${parsed.host.toLowerCase()}/${parsed.slug.toLowerCase()}` : raw.trim().toLowerCase()
}

/** Where the panel says a repository lives on this host, in the panel's own words. */
export function registeredPath(project: RegisteredProject, repository: RegisteredRepository): string | null {
  if (repository.scanPath) return repository.scanPath
  if (repository.localPath) return repository.localPath
  if (!project.resolvedPath) return null
  return repository.relativePath ? resolve(project.resolvedPath, repository.relativePath) : project.resolvedPath
}

function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function basisOf(facts: PathFacts, candidate: Candidate): ResolveBasis | null {
  const real = candidate.path ? safeRealpath(candidate.path) : null
  if (real) {
    if (facts.path === real) return 'root'
    if (inside(facts.path, real)) return 'subdirectory'
    if (facts.commonRoot === real && facts.gitRoot !== real) return 'worktree'
  }
  const wanted = remoteKey(facts.remote)
  if (wanted && wanted === remoteKey(candidate.repository.remoteUrl)) return 'remote'
  return null
}

/**
 * The registry, one request per Project. There is no list-all route for
 * repositories, and a Project the caller may not see is simply absent here.
 */
export async function registeredProjects(client: PanelClient): Promise<RegisteredProject[]> {
  const list = await client.request<{ projects: Array<{ slug: string }> }>('GET', '/projects')
  return Promise.all(
    list.projects.map((summary) => client.request<RegisteredProject>('GET', `/projects/${segment(summary.slug)}`)),
  )
}

/** Resolve a directory to the Project that registered it. Reads the host and the panel; writes nothing. */
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

  const matches: Array<Candidate & { basis: ResolveBasis }> = []
  for (const project of projects) {
    for (const repository of project.repositories) {
      const path = registeredPath(project, repository)
      const candidate: Candidate = { project, repository, path, exists: path !== null && existsSync(path) }
      const basis = basisOf(facts, candidate)
      if (basis) matches.push({ ...candidate, basis })
    }
  }

  if (matches.length === 0) {
    return failure(
      real,
      'unknown',
      `${real} belongs to no Project the panel knows`,
      'add the repository to a Project in the panel, or check `portta projects list`',
      [],
    )
  }

  const best = BASIS_ORDER.find((basis) => matches.some((match) => match.basis === basis))!
  const top = matches.filter((match) => match.basis === best)
  const asCandidate = (match: Candidate & { basis: ResolveBasis }) => ({
    slug: match.project.slug,
    repository: match.repository.name,
    path: match.path,
    basis: match.basis,
  })

  // A remote match against a registration whose path is gone is a stale
  // record: the panel points somewhere that no longer exists, and this
  // directory is probably where it went. Reported as such, never adopted.
  if (best === 'remote' && top.every((match) => match.path !== null && !match.exists)) {
    return failure(
      real,
      'stale',
      `the panel registers ${top.map((match) => `${match.project.slug}/${match.repository.name}`).join(', ')} at a path that no longer exists on this host`,
      `update the repository's path in the panel to ${real}`,
      top.map(asCandidate),
    )
  }

  const slugs = new Set(top.map((match) => match.project.slug))
  if (slugs.size > 1) {
    return failure(
      real,
      'ambiguous',
      `${real} could belong to ${[...slugs].join(' or ')}; nothing was chosen`,
      'name the Project explicitly, or remove the duplicate registration in the panel',
      top.map(asCandidate),
    )
  }

  const match = top[0]!
  return {
    resolved: true,
    path: real,
    basis: best,
    certain: best !== 'remote',
    project: { id: match.project.id, slug: match.project.slug, name: match.project.name },
    repository: {
      id: match.repository.id,
      name: match.repository.name,
      path: match.path,
      remoteUrl: match.repository.remoteUrl,
    },
    git: { root: facts.gitRoot, branch: facts.branch, remote: facts.remote },
    worktree:
      best === 'worktree' && facts.gitRoot && facts.commonRoot
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
  stale: EXIT.precondition,
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
      output.line(
        `  ${candidate.slug.padEnd(20)} ${candidate.repository.padEnd(20)} ${candidate.path ?? '-'}  [${candidate.basis}]`,
      )
    if (outcome.error.hint) output.hint(outcome.error.hint)
    process.exitCode = EXIT_BY_KIND[outcome.error.kind]
    return
  }
  output.line(
    `${outcome.project.name} (${outcome.project.slug}) · ${outcome.repository.name} · by ${outcome.basis}${outcome.certain ? '' : ' (inferred from the remote)'}`,
  )
  if (outcome.worktree) output.line(`  worktree of ${outcome.worktree.mainPath}`)
  if (outcome.git.branch) output.line(`  branch ${outcome.git.branch}`)
  output.line(`  portta projects context ${outcome.project.slug} --json`)
}

export async function projectsResolve(options: { path?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const outcome = await resolvePath(options.path ?? process.cwd(), client)
  reportOutcome(output, outcome)
}
