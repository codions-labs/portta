// The named-workflow registry: resolve a bare name (e.g. `taskflow run code-review`) to a
// workflow file across three tiers, highest precedence first:
//   1. project — every `.portta/workflows/` from cwd up to the repo/home boundary
//   2. user    — `<dataRoot()>/workflows/` (~/.portta/state/host/workflows)
//   3. builtin — the package's `builtins/` directory (ships with the npm tarball)
// A workflow's name is its `meta.name`, NOT its filename — files are scanned and parsed to match.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globalPaths, projectPaths } from 'portta-core/taskflow/paths'
import { dataRoot } from './journal.ts'
import { parseWorkflow } from './sandbox.ts'

export type Tier = 'project' | 'user' | 'builtin'

export interface RegistryEntry {
  name: string
  tier: Tier
  filePath: string
  description: string
}

export interface WorkflowRegistryRoots {
  projectDirs?: string[]
  globalDir?: string
  builtinDir?: string
  dataRoot?: string
}

/** A registry file larger than this is skipped — matches Claude Code's inline-script cap. */
const MAX_WORKFLOW_BYTES = 524_288

export class WorkflowNotFoundError extends Error {
  constructor(name: string, available: string[]) {
    super(`workflow "${name}" not found. Available: ${available.length > 0 ? available.join(', ') : '(none)'}`)
    this.name = 'WorkflowNotFoundError'
  }
}

/**
 * The builtin workflows directory, resolved package-relative. tsup bundles flat, so from the
 * build this module's URL is dist/cli.js (one `..` to the package root); from source under tsx
 * it is src/runtime/registry.ts (two `..`). Probe both rather than hardcoding either layout.
 */
export function builtinDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const rel of [
    ['..', 'builtins'],
    ['..', '..', 'builtins'],
    ['..', '..', '..', '..', '..', 'workflows'],
  ]) {
    const candidate = join(here, ...rel)
    if (existsSync(candidate)) return candidate
  }
  // Nothing on disk (e.g. a stripped install) — return the dist-relative path; scans existsSync it.
  return join(here, '..', 'builtins')
}

/**
 * Project-tier directories: every `<dir>/.portta/workflows` walking up from `cwd`, nearest
 * first (nearer shadows farther). The walk stops after the first directory that contains `.git`
 * (the repo boundary) and never escapes past the home directory or the filesystem root.
 */
function projectDirs(cwd: string): string[] {
  const dirs: string[] = []
  const home = homedir()
  let dir = resolve(cwd)
  for (;;) {
    const workflows = projectPaths(dir).workflows
    if (existsSync(workflows)) dirs.push(workflows)
    if (existsSync(join(dir, '.git'))) break // repo boundary — include it, go no farther
    const parent = dirname(dir)
    if (dir === home || parent === dir) break
    dir = parent
  }
  return dirs
}

/** All tier directories in precedence order (dirs may not exist; scans check). */
export function workflowDirs(cwd?: string, roots?: WorkflowRegistryRoots): { tier: Tier; dir: string }[] {
  if (roots) {
    return [
      ...(roots.projectDirs ?? projectDirs(cwd ?? process.cwd())).map((dir) => ({
        tier: 'project' as Tier,
        dir: resolve(dir),
      })),
      { tier: 'user' as Tier, dir: roots.globalDir ?? join(dataRoot({ dataRoot: roots.dataRoot }), 'workflows') },
      { tier: 'builtin' as Tier, dir: roots.builtinDir ?? builtinDir() },
    ]
  }
  return [
    ...projectDirs(cwd ?? process.cwd()).map((dir) => ({ tier: 'project' as Tier, dir })),
    { tier: 'user' as Tier, dir: globalPaths().workflows },
    { tier: 'builtin' as Tier, dir: builtinDir() },
  ]
}

/**
 * Scan one directory for loadable workflows: `.js` files within the size cap whose `meta`
 * parses. Invalid/oversize files are skipped (the registry must never crash on a stray file).
 * Sorted readdir keeps within-dir collisions deterministic (first name occurrence wins).
 */
function scanDir(tier: Tier, dir: string): RegistryEntry[] {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return []
  }
  const entries: RegistryEntry[] = []
  for (const file of names) {
    if (!file.endsWith('.js')) continue
    const filePath = join(dir, file)
    try {
      if (statSync(filePath).size > MAX_WORKFLOW_BYTES) continue
      const { meta } = parseWorkflow(readFileSync(filePath, 'utf8'))
      entries.push({ name: meta.name, tier, filePath, description: meta.description })
    } catch {}
  }
  return entries
}

/**
 * All named workflows visible from `cwd`, winners only: project shadows user shadows builtin,
 * and within a tier the first (sorted) file claiming a name wins.
 */
export function listWorkflows(cwd?: string, roots?: WorkflowRegistryRoots): RegistryEntry[] {
  const seen = new Set<string>()
  const out: RegistryEntry[] = []
  for (const { tier, dir } of workflowDirs(cwd, roots)) {
    for (const entry of scanDir(tier, dir)) {
      if (seen.has(entry.name)) continue
      seen.add(entry.name)
      out.push(entry)
    }
  }
  return out
}

/** Resolve a workflow name to an absolute file path, or throw WorkflowNotFoundError. */
export function resolveWorkflowName(name: string, cwd?: string, roots?: WorkflowRegistryRoots): string {
  const entries = listWorkflows(cwd, roots)
  const hit = entries.find((e) => e.name === name)
  if (!hit)
    throw new WorkflowNotFoundError(
      name,
      entries.map((e) => e.name),
    )
  return hit.filePath
}
