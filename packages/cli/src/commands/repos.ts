// `portta repos`: what the host knows about every repository, collected here
// and read by the panel.
//
// Keyed by repository, not by environment. Two worktrees of one repository are
// two repositories (two roots); one repository running as three Compose
// projects is one file with three environments in it. The index maps each
// environment to the repository it runs from, which is how the panel answers
// "what code is this environment running" without a project directory.
//
// The scan reads: local `git` (branch, HEAD, dirty counts, ahead/behind, the
// last RECENT_COMMITS commits as metadata) and the instruction files on the
// allowlist in portta-core. Nothing else: no diff, no arbitrary file, never a
// `.env`. ADR 0032 amends ADR 0010 for exactly these two additions.

import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { Command } from 'commander'
import {
  classifyProjectLocation,
  firstLevelCandidateName,
  GIT_LOG_FORMAT,
  INSTRUCTION_DIRECTORIES,
  INSTRUCTION_FILES,
  INSTRUCTION_MAX_BYTES,
  type InstructionFile,
  instructionAudience,
  isInstructionPath,
  normalizeProjectsHome,
  parseGitLog,
  RECENT_COMMITS,
  type RepositoryScan,
  relativeRepositoryPath,
  repositoryKey,
  repositoryName,
  SCAN_INDEX_FILE,
  SCAN_VERSION,
  type ScanIndex,
  type ScanIndexEntry,
  SPEC_KIT_MARKER,
  SPECIFICATION_MAX_COUNT,
  SPECIFICATION_ROOTS,
  SPECIFICATION_TITLE_BYTES,
  type SpecificationReference,
  specificationOf,
  specificationTitle,
} from 'portta-core'
import { panelClient, segment } from '../api.js'
import { type GatewayContext, gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { CliError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { collectGitProject } from './git.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

export interface ReposScanOptions {
  /** Only the repository this environment runs from */
  environment?: string
  /** Only this directory (must be inside a git work tree) */
  path?: string
  withPrs?: boolean
  forgeTtl?: string
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  const result = await runProcess('git', ['-C', cwd, ...args], { reject: false })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** The git root that owns a directory, realpath'd, or null when it is not in a work tree. */
export async function gitRootOf(path: string): Promise<string | null> {
  const real = safeRealpath(path)
  if (!real) return null
  const top = await git(real, ['rev-parse', '--show-toplevel'])
  return top ? safeRealpath(top) : null
}

function workdir(labels: Record<string, string>): string | null {
  return labels['portta.git.root'] ?? labels['com.docker.compose.project.working_dir'] ?? null
}

interface Candidate {
  root: string
  declaredRemote: string
  environments: Set<string>
}

/**
 * The local paths the panel has registered. A repository the operator named by
 * hand is collected even where the Home walk would not look: a hidden
 * directory, a path outside the Home. There is no list-all route, so this is
 * one request per Project. Panel down, no database, no credential, a remote
 * URL without --allow-remote: an empty list, and the scan goes on.
 */
export async function registeredRepositoryPaths(
  context: GatewayContext,
  detail: (line: string) => void = () => {},
): Promise<string[]> {
  const skipped = (why: string): string[] => {
    detail(`registered repositories skipped: ${why}`)
    return []
  }
  let client: ReturnType<typeof panelClient>
  try {
    client = panelClient(context)
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error))
  }
  try {
    const projects = await client.answer('GET', '/projects')
    if (!projects.ok) return skipped(`the panel answered ${projects.status} to /api/projects`)
    const slugs = ((JSON.parse(projects.text) as { projects?: Array<{ slug?: string }> }).projects ?? [])
      .map((project) => project.slug)
      .filter((slug): slug is string => typeof slug === 'string')
    const paths: string[] = []
    for (const slug of slugs) {
      const answer = await client.answer('GET', `/projects/${segment(slug)}/repositories`)
      if (!answer.ok) continue
      for (const repository of (JSON.parse(answer.text) as { repositories?: Array<{ localPath?: string | null }> })
        .repositories ?? []) {
        if (typeof repository.localPath === 'string' && repository.localPath !== '') paths.push(repository.localPath)
      }
    }
    return paths
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Every repository this scan should look at, from four sources: the working
 * directories of running Compose projects, the paths the panel has registered,
 * the first level of Projects Home (and one level below it, for workspace
 * directories that hold repositories), and an explicit --path. Deduplicated
 * by realpath of the git root.
 */
export async function findCandidates(
  options: ReposScanOptions,
  env: NodeJS.ProcessEnv,
  registered: readonly string[] = [],
): Promise<{ candidates: Map<string, Candidate>; home: string | null }> {
  const candidates = new Map<string, Candidate>()
  const add = (root: string, environment?: string, declaredRemote = '') => {
    const existing = candidates.get(root) ?? { root, declaredRemote: '', environments: new Set<string>() }
    if (environment) existing.environments.add(environment)
    if (declaredRemote && !existing.declaredRemote) existing.declaredRemote = declaredRemote
    candidates.set(root, existing)
  }

  if (options.path) {
    const root = await gitRootOf(options.path)
    if (!root) throw new UsageError(`${options.path} is not inside a git work tree`)
    add(root)
  }

  let containers: Awaited<ReturnType<typeof inspectContainers>> = []
  try {
    containers = await inspectContainers(false)
  } catch {
    // No Docker, or no permission to ask: the filesystem sources still work.
  }
  for (const container of containers) {
    const name = container.labels['com.docker.compose.project']
    const path = workdir(container.labels)
    if (!name || !path) continue
    if (options.environment && options.environment !== name) continue
    if (options.path) continue
    const root = await gitRootOf(path)
    if (root) add(root, name, container.labels['portta.repo'] ?? '')
  }

  // A registered path is the operator's explicit ask, so it is not subject to
  // the hidden-name rule of the Home walk: only to existing and being a work tree.
  if (!options.environment && !options.path) {
    for (const path of registered) {
      if (!existsSync(path)) continue
      const root = await gitRootOf(path)
      if (root) add(root)
    }
  }

  let home: string | null = null
  const rawHome = env.PORTTA_PROJECTS_HOME
  if (rawHome) {
    try {
      home = normalizeProjectsHome(rawHome, process.cwd(), env.HOME ?? '')
    } catch {
      home = null
    }
  }
  if (home && !options.environment && !options.path && existsSync(home)) {
    let entries: string[] = []
    try {
      entries = readdirSync(home)
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!firstLevelCandidateName(entry)) continue
      const path = join(home, entry)
      if (!isDirectory(path)) continue
      if (existsSync(join(path, '.git'))) {
        const root = await gitRootOf(path)
        if (root) add(root)
        continue
      }
      // A workspace directory: one level down, and no further. A repository
      // three levels deep is not offered; that keeps the walk bounded and the
      // relative path at most two segments.
      let children: string[] = []
      try {
        children = readdirSync(path)
      } catch {
        continue
      }
      for (const child of children) {
        if (!firstLevelCandidateName(child)) continue
        const childPath = join(path, child)
        if (!isDirectory(childPath) || !existsSync(join(childPath, '.git'))) continue
        const root = await gitRootOf(childPath)
        if (root) add(root)
      }
    }
  }
  return { candidates, home }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** The instruction files present at a root, on the allowlist and nowhere else. */
export async function collectInstructions(root: string): Promise<InstructionFile[]> {
  const paths: string[] = [...INSTRUCTION_FILES]
  for (const { directory, extension } of INSTRUCTION_DIRECTORIES) {
    const dir = join(root, directory)
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir).sort()) {
        if (entry.endsWith(extension)) paths.push(`${directory}/${entry}`)
      }
    } catch {
      // unreadable directory: nothing to list
    }
  }
  const files: InstructionFile[] = []
  for (const relative of paths) {
    if (!isInstructionPath(relative)) continue
    const absolute = join(root, relative)
    if (!existsSync(absolute)) continue
    let size: number
    let modifiedAt: number
    try {
      const stat = statSync(absolute)
      if (!stat.isFile()) continue
      size = stat.size
      modifiedAt = Math.floor(stat.mtimeMs / 1000)
    } catch {
      continue
    }
    const raw = readFileSync(absolute)
    const truncated = size > INSTRUCTION_MAX_BYTES
    const status = await git(root, ['status', '--porcelain', '--untracked-files=all', '--', relative])
    files.push({
      path: relative,
      audience: instructionAudience(relative),
      sizeBytes: size,
      modifiedAt,
      sha256: sha256(raw),
      dirty: status !== null && status !== '',
      content: truncated ? null : raw.toString('utf8'),
      truncated,
    })
  }
  return files
}

/** The files under a directory, at most `depth` levels down, never inside `.git` or `node_modules`. */
function filesBelow(root: string, directory: string, depth: number): string[] {
  const found: string[] = []
  const visit = (relative: string, remaining: number): void => {
    let entries: string[]
    try {
      entries = readdirSync(join(root, relative)).sort()
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === '.git' || entry === 'node_modules') continue
      const path = `${relative}/${entry}`
      let directoryEntry: boolean
      try {
        directoryEntry = statSync(join(root, path)).isDirectory()
      } catch {
        continue
      }
      if (directoryEntry) {
        if (remaining > 0) visit(path, remaining - 1)
      } else found.push(path)
    }
  }
  if (isDirectory(join(root, directory))) visit(directory, depth)
  return found
}

/** The paths git reports as differing from HEAD, from one `status --porcelain` over the given files. */
async function dirtyPaths(root: string, paths: readonly string[]): Promise<Set<string>> {
  const dirty = new Set<string>()
  if (paths.length === 0) return dirty
  // Untrimmed on purpose: a porcelain line starts with its status columns, and
  // a leading space (` M`) is one of them.
  const status = await runProcess(
    'git',
    ['-C', root, 'status', '--porcelain', '--untracked-files=all', '-z', '--', ...paths],
    { reject: false },
  )
  if (status.exitCode !== 0) return dirty
  for (const entry of status.stdout.split('\0')) {
    if (entry.length < 4) continue
    const path = entry.slice(3)
    dirty.add(path)
  }
  return dirty
}

/**
 * The specification documents at a root, as references: decision records,
 * and the trees OpenSpec and Spec Kit leave. Bounded like the instruction
 * walk — named directories, a fixed depth, an allowlist of shapes — and it
 * reads no more of a document than its opening bytes, for the title.
 */
export async function collectSpecifications(root: string): Promise<SpecificationReference[]> {
  const specKit = isDirectory(join(root, SPEC_KIT_MARKER))
  const candidates = new Map<string, { provider: string; kind: string }>()
  for (const { directory, depth } of SPECIFICATION_ROOTS) {
    for (const relative of filesBelow(root, directory, depth)) {
      const source = specificationOf(relative, { specKit })
      if (source) candidates.set(relative, source)
    }
  }
  const paths = [...candidates.keys()].sort().slice(0, SPECIFICATION_MAX_COUNT)
  const dirty = await dirtyPaths(root, paths)
  const references: SpecificationReference[] = []
  for (const relative of paths) {
    const source = candidates.get(relative)
    if (!source) continue
    const absolute = join(root, relative)
    let raw: Buffer
    let modifiedAt: number
    try {
      const stat = statSync(absolute)
      if (!stat.isFile()) continue
      modifiedAt = Math.floor(stat.mtimeMs / 1000)
      raw = readFileSync(absolute)
    } catch {
      continue
    }
    references.push({
      path: relative,
      provider: source.provider,
      kind: source.kind,
      title: specificationTitle(raw.subarray(0, SPECIFICATION_TITLE_BYTES).toString('utf8')),
      sizeBytes: raw.length,
      modifiedAt,
      sha256: sha256(raw),
      dirty: dirty.has(relative),
    })
  }
  return references
}

export async function collectRepository(
  candidate: Candidate,
  options: ReposScanOptions,
  cachedForge?: Record<string, unknown>,
): Promise<RepositoryScan> {
  const name = repositoryName(candidate.root)
  const record = await collectGitProject(name, candidate.root, candidate.declaredRemote, options.withPrs, cachedForge)
  const gitInfo = (record.git ?? null) as RepositoryScan['git']
  const log = gitInfo ? await git(candidate.root, ['log', `-n${RECENT_COMMITS}`, `--format=${GIT_LOG_FORMAT}`]) : null
  return {
    version: SCAN_VERSION,
    key: repositoryKey(candidate.root),
    path: candidate.root,
    name,
    collectedAt: Number(record.collectedAt ?? Math.floor(Date.now() / 1000)),
    git: gitInfo,
    reason: (record.reason as string | null | undefined) ?? null,
    commits: log ? parseGitLog(log) : [],
    instructions: gitInfo ? await collectInstructions(candidate.root) : [],
    specifications: gitInfo ? await collectSpecifications(candidate.root) : [],
    environments: [...candidate.environments].sort(),
    forge: (record.forge as Record<string, unknown> | undefined) ?? null,
  }
}

function writeSecret(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface ScanResult {
  index: ScanIndex
  repositories: RepositoryScan[]
}

/**
 * Scan and write. A partial scan (--environment, --path) rewrites only the
 * files it touched and merges into the existing index, so a targeted refresh
 * never forgets the repositories it did not look at.
 */
export async function scanRepositories(
  options: ReposScanOptions = {},
  profile?: string,
  output = new Output({ quiet: true }),
): Promise<ScanResult> {
  if (options.forgeTtl !== undefined && !/^\d+$/.test(options.forgeTtl))
    throw new UsageError('--forge-ttl must be a number of seconds')
  const context = gatewayContext({ profile })
  const directory = join(context.root, 'state/git')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const partial = Boolean(options.environment || options.path)
  const registered = partial ? [] : await registeredRepositoryPaths(context, (line) => output.detail(line))
  const { candidates, home } = await findCandidates(options, context.env, registered)
  // A walk of the projects home with a `git` call per repository. It is fast
  // per repository and slow in total, so it reports a count rather than a
  // ticker: seeing 12/40 answers "is it stuck?" better than an elapsed time.
  if (candidates.size > 0) {
    output.progress(
      `scanning ${candidates.size} ${candidates.size === 1 ? 'repository' : 'repositories'}${home && existsSync(home) ? ` under ${home}` : ''}`,
    )
  }
  const forgeTtl = Number(options.forgeTtl ?? 300)
  const now = Math.floor(Date.now() / 1000)
  const homeReal = home ? safeRealpath(home) : null

  const previous = partial ? (readJson(join(directory, SCAN_INDEX_FILE)) as unknown as ScanIndex | null) : null
  const entries = new Map<string, ScanIndexEntry>()
  const environments: Record<string, string> = {}
  if (previous && previous.version === SCAN_VERSION) {
    for (const entry of previous.repositories ?? []) entries.set(entry.key, entry)
    Object.assign(environments, previous.environments ?? {})
  }

  const repositories: RepositoryScan[] = []
  for (const candidate of candidates.values()) {
    const key = repositoryKey(candidate.root)
    const target = join(directory, `${key}.json`)
    let cachedForge: Record<string, unknown> | undefined
    if (options.withPrs && forgeTtl > 0 && existsSync(target)) {
      const forge = readJson(target)?.forge as Record<string, unknown> | undefined
      if (forge && now - Number(forge.collectedAt ?? 0) < forgeTtl) cachedForge = forge
    }
    output.detail(`scanning ${candidate.root}`)
    const scan = await collectRepository(candidate, options, cachedForge)
    if (partial) {
      // Keep the environments a full scan already attributed to this root.
      const known = Object.entries(environments)
        .filter(([, k]) => k === key)
        .map(([environment]) => environment)
      scan.environments = [...new Set([...scan.environments, ...known])].sort()
    }
    writeSecret(target, scan)
    repositories.push(scan)
    entries.set(key, {
      key,
      path: candidate.root,
      name: scan.name,
      remote: scan.git?.remote ?? null,
      location: home
        ? classifyProjectLocation({ home, path: candidate.root, homeRealpath: homeReal, pathRealpath: candidate.root })
        : null,
      relativePath: home ? relativeRepositoryPath(homeReal ?? home, candidate.root) : null,
    })
    for (const environment of scan.environments) environments[environment] = key
  }

  const index: ScanIndex = {
    version: SCAN_VERSION,
    collectedAt: now,
    home: homeReal ?? home,
    repositories: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    environments,
  }
  writeSecret(join(directory, SCAN_INDEX_FILE), index)
  return { index, repositories }
}

export async function reposScan(options: ReposScanOptions, command: Command): Promise<void> {
  const output = new Output(globals(command))
  const result = await scanRepositories(options, globals(command).profile, output)
  if (output.json) output.data(result)
  else
    output.progress(`scanned ${result.repositories.length} repositor${result.repositories.length === 1 ? 'y' : 'ies'}`)
}

/** The index, or null when nothing was collected. A file that exists and cannot be read is an operational failure, not an empty answer. */
export function readScanIndex(root: string): ScanIndex | null {
  const path = join(root, 'state/git', SCAN_INDEX_FILE)
  if (!existsSync(path)) return null
  const value = readJson(path)
  if (value === null)
    throw new CliError(`${path} is not readable JSON`, undefined, 'run `portta repos scan` to rewrite it')
  return value.version === SCAN_VERSION ? (value as unknown as ScanIndex) : null
}

export async function reposStatus(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const index = readScanIndex(context.root)
  const output = new Output(globals(command))
  const now = Math.floor(Date.now() / 1000)
  const repositories = (index?.repositories ?? []).map((entry) => {
    const scan = readJson(join(context.root, 'state/git', `${entry.key}.json`))
    const gitInfo = (scan?.git ?? null) as Record<string, unknown> | null
    return {
      ...entry,
      branch: gitInfo?.branch ?? null,
      dirty: gitInfo?.dirty === true,
      environments: Object.entries(index?.environments ?? {})
        .filter(([, key]) => key === entry.key)
        .map(([environment]) => environment),
      ageSeconds: Math.max(0, now - Number(scan?.collectedAt ?? index?.collectedAt ?? now)),
    }
  })
  if (output.json) {
    output.data({ collectedAt: index?.collectedAt ?? null, home: index?.home ?? null, repositories })
    return
  }
  if (repositories.length === 0) {
    output.progress('nothing collected yet: run `portta repos scan`')
    return
  }
  for (const repository of repositories) {
    output.line(
      `${repository.name}\t${String(repository.branch ?? 'detached')}${repository.dirty ? ' (dirty)' : ''}\t${repository.environments.join(',') || '-'}\t${repository.ageSeconds}s old`,
    )
  }
}

/** The specification references the last scan collected, for every repository or the one at `--path`. */
export async function reposSpecs(options: { path?: string }, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const output = new Output(globals(command))
  const index = readScanIndex(context.root)
  const wanted = options.path ? safeRealpath(options.path) : null
  if (options.path && !wanted)
    throw new UsageError(`${options.path} does not exist on this host`, 'pass the git root of a scanned repository')
  const repositories = (index?.repositories ?? [])
    .filter((entry) => !wanted || entry.path === wanted)
    .map((entry) => {
      const scan = readJson(join(context.root, 'state/git', `${entry.key}.json`))
      const collected = scan?.specifications
      const specifications = Array.isArray(collected) ? (collected as SpecificationReference[]) : []
      return {
        key: entry.key,
        path: entry.path,
        name: entry.name,
        collectedAt: Number(scan?.collectedAt ?? index?.collectedAt ?? 0) || null,
        specifications,
      }
    })
  if (output.json) {
    output.data({ collectedAt: index?.collectedAt ?? null, repositories })
    return
  }
  if (repositories.length === 0) {
    output.progress(
      wanted
        ? `${wanted} is not a scanned repository: run \`portta repos scan --path ${wanted}\``
        : 'nothing collected yet: run `portta repos scan`',
    )
    return
  }
  for (const repository of repositories) {
    output.line(`${repository.name}  ${repository.path}`)
    if (repository.specifications.length === 0) output.line('  (no decision records or specification trees recognised)')
    for (const reference of repository.specifications) {
      output.line(
        `  ${`${reference.provider}/${reference.kind}`.padEnd(24)} ${reference.path}${reference.title ? `  ${reference.title}` : ''}${reference.dirty ? '  (dirty)' : ''}`,
      )
    }
  }
}

export async function reposClear(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const directory = join(context.root, 'state/git')
  if (!existsSync(directory)) return
  let count = 0
  for (const file of readdirSync(directory)) {
    if (file.endsWith('.json')) {
      unlinkSync(join(directory, file))
      count++
    }
  }
  new Output(globals(command)).progress(`removed ${count} collected file(s) from ${basename(directory)}`)
}

/** Called from `up` and `web up`: never fatal, always says why it failed. */
export async function refreshRepositories(profile: string | undefined, output: Output): Promise<void> {
  try {
    await scanRepositories({}, profile, output)
  } catch (error) {
    output.warning(
      `repository metadata could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
