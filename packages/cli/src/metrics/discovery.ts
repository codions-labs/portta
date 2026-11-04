// Finds the project folders under Projects Home and publishes what adopting each would do.
//
// The panel never opens Projects Home and cannot ask the host to: this runs on the host, finds the
// folders that hold a Compose file, runs the same read-only analysis `portta analyze` does and
// writes the result under state/discovery/. Nothing here starts, stops or changes anything, and a
// folder is only listed when it is a real folder (no link) inside Projects Home. See
// docs/development/adr/0059-the-collector-finds-and-reviews-project-folders.md.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import {
  DISCOVERY_MAX_DEPTH,
  DISCOVERY_MAX_FOLDERS,
  type DiscoveredFolder,
  type DiscoveredFolders,
  defaultProjectsHome,
  type FolderPlan,
  fileKey,
  isDiscoverablePath,
  normalizeProjectsHome,
  parseEnv,
} from 'portta-core'
import { parseDocument } from 'yaml'
import { analyze, readSmallFile } from '../commands/projects.js'
import { appendLog, writeAtomic } from './store.js'

const COMPOSE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
const SKIPPED = new Set(['node_modules', 'lost+found', 'vendor', 'dist', 'build'])
const PLANS_PER_CYCLE = 8
const REPLAN_MS = 5 * 60_000

/** Parts of the system that are never a place for projects, and anything under them. */
const SYSTEM_ROOTS = ['/etc', '/proc', '/sys', '/dev', '/boot', '/var/lib/docker', '/var/run', '/run']
/** Folders that hold a user's whole account: `/root`, `/home`, `/home/ada`, `/Users/ada`. Projects live in a folder inside them. */
const ACCOUNT_FOLDER = /^\/(?:root|home|Users|home\/[^/]+|Users\/[^/]+)\/*$/

/**
 * A Projects Home the collector will walk: a folder somebody keeps projects in, never a part of the
 * system and never a whole account. `/root/projects` is a place for projects; `/root` and `/root/.ssh`
 * are not.
 */
export function isWalkableHome(home: string): boolean {
  const parts = home.split('/').filter(Boolean)
  if (parts.length < 2 || parts.some((part) => part.startsWith('.'))) return false
  if (ACCOUNT_FOLDER.test(home)) return false
  return !SYSTEM_ROOTS.some((root) => home === root || home.startsWith(`${root}/`))
}

/**
 * Whether a Compose file reaches outside the folder to fetch something: an `include` or `extends` that
 * names an OCI artifact, a git repository or a URL. Reading it would have Compose download it, and the
 * collector does this on its own, so those folders are listed and not analysed.
 */
export function reachesOut(composeText: string): boolean {
  return /(oci:\/\/|git\+[a-z]+:\/\/|git@[\w.-]+:|\b(?:file|path|extends):\s*['"]?https?:\/\/|^\s*-\s*['"]?https?:\/\/)/im.test(
    composeText,
  )
}

/**
 * Whether an `include:` entry or a service's `extends.file` names a path that leaves the folder: Compose
 * reads it, so the collector must not hand it a file that is not the project's. A `file:` of a secret or a
 * config is not read by `config`, and is not looked at. The file is read as Compose reads it, with merge keys
 * (`<<: *base`) applied. Whatever the two readers could take differently counts as reaching outside: a file
 * that does not parse, a tag this reader does not know (`!!binary` is bytes here and a string to Compose), and
 * a path that is not plain text. Compose would refuse most of those anyway, so little is lost by not reviewing.
 */
export function includesOutside(composeText: string, directory: string): boolean {
  let document: unknown
  try {
    const parsed = parseDocument(composeText, { merge: true })
    if (parsed.errors.length > 0 || parsed.warnings.length > 0) return true
    document = parsed.toJS()
  } catch {
    return true
  }
  if (typeof document !== 'object' || document === null) return false
  const root = document as { include?: unknown; services?: unknown }
  const paths: unknown[] = []
  const included = typeof root.include === 'string' ? [root.include] : Array.isArray(root.include) ? root.include : []
  for (const entry of included) {
    if (typeof entry === 'string') paths.push(entry)
    else if (typeof entry === 'object' && entry !== null) {
      const path = (entry as { path?: unknown }).path
      paths.push(...(Array.isArray(path) ? path : [path]))
    }
  }
  const services = typeof root.services === 'object' && root.services !== null ? Object.values(root.services) : []
  for (const service of services) {
    const extended = (service as { extends?: unknown } | null)?.extends
    if (typeof extended === 'object' && extended !== null) paths.push((extended as { file?: unknown }).file)
  }
  return paths.some((value) => {
    if (value === undefined || value === null) return false
    if (typeof value !== 'string') return true
    if (value === '') return false
    const target = resolve(directory, value)
    return target !== directory && !target.startsWith(`${directory}${sep}`)
  })
}

export function discoveryDir(root: string): string {
  return join(root, 'state/discovery')
}

/** Projects Home as the host has it: `.env`, else next to the user's work. */
export function projectsHomeOf(root: string): string | null {
  try {
    const env = existsSync(join(root, '.env'))
      ? parseEnv(readFileSync(join(root, '.env'), 'utf8'))
      : new Map<string, string>()
    const configured = env.get('PORTTA_PROJECTS_HOME')?.trim()
    const home = configured && configured !== '' ? configured : defaultProjectsHome(homedir(), process.getuid?.() === 0)
    const normalized = normalizeProjectsHome(home, root, homedir())
    return isWalkableHome(normalized) ? normalized : null
  } catch {
    return null
  }
}

/** The folders that hold a Compose file, at most three levels down, never through a link. */
export function findComposeFolders(home: string): Array<{ path: string; composeFile: string; modifiedAt: number }> {
  const found: Array<{ path: string; composeFile: string; modifiedAt: number }> = []
  const walk = (directory: string, depth: number) => {
    if (found.length >= DISCOVERY_MAX_FOLDERS || depth > DISCOVERY_MAX_DEPTH) return
    let names: string[]
    try {
      names = readdirSync(directory)
    } catch {
      return
    }
    const compose = COMPOSE_NAMES.find((name) => names.includes(name))
    if (compose && depth > 0) {
      const file = join(directory, compose)
      const info = lstatSync(file, { throwIfNoEntry: false })
      const path = relative(home, directory).split(/[\\/]/).join('/')
      if (info?.isFile() && isDiscoverablePath(path)) {
        found.push({ path, composeFile: compose, modifiedAt: Math.floor(info.mtimeMs / 1000) })
        return
      }
    }
    for (const name of names.sort()) {
      if (name.startsWith('.') || SKIPPED.has(name)) continue
      const info = lstatSync(join(directory, name), { throwIfNoEntry: false })
      if (info?.isDirectory() && !info.isSymbolicLink()) walk(join(directory, name), depth + 1)
    }
  }
  walk(home, 0)
  return found
}

const planned = new Map<string, { at: number; modifiedAt: number; plan: FolderPlan | null }>()

async function planFolder(
  root: string,
  home: string,
  folder: { path: string; composeFile: string; modifiedAt: number },
): Promise<FolderPlan | null> {
  const directory = join(home, folder.path)
  const text = readSmallFile(join(directory, folder.composeFile), 1024 * 1024)
  if (text === 'absent' || text === 'refused') {
    appendLog(root, `discovery: ${folder.path} not reviewed: its Compose file is a link, a pipe or over 1 MB`)
    return null
  }
  if (reachesOut(text) || includesOutside(text, directory)) {
    appendLog(root, `discovery: ${folder.path} not reviewed: its Compose file reaches outside the folder`)
    return null
  }
  const report = await analyze(directory, { unattended: true }).catch((error: unknown) => {
    appendLog(
      root,
      `discovery: ${folder.path} not reviewed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    )
    return null
  })
  if (!report) return null
  return {
    version: 1,
    path: folder.path,
    composeFile: report.compose_file,
    project: report.project,
    domain: report.domain,
    adopted: report.gateway_overlay !== null,
    services: report.services.map((service) => ({
      name: service.name,
      image: service.image,
      kind: service.kind,
      port: service.kind === 'http' ? (service.container_ports[0] ?? service.expose[0] ?? null) : null,
      publishedPorts: service.published_ports.map((port) => ({
        host: String(port.host),
        container: String(port.container),
      })),
      containerName: service.container_name,
    })),
    findings: {
      publishedHostPorts: report.findings.published_host_ports,
      fixedContainerNames: report.findings.fixed_container_names,
      publishedDatastores: report.findings.published_datastores,
      implicitNamespace: report.findings.implicit_namespace,
      containerNameCollisions: report.findings.container_name_collisions.map((entry) => ({
        service: entry.service,
        containerName: entry.container_name,
        usedBy: entry.used_by,
      })),
      namespaceInUse: report.findings.namespace_in_use
        ? {
            project: report.findings.namespace_in_use.project,
            workingDirs: report.findings.namespace_in_use.working_dirs,
          }
        : null,
    },
    collectedAt: Math.floor(Date.now() / 1000),
  }
}

/** Publishes the folders and the plans that are due. Never throws: the metrics go on without it. */
export async function publishDiscovery(root: string, now = Date.now()): Promise<void> {
  try {
    const home = projectsHomeOf(root)
    const base = discoveryDir(root)
    if (!home || !existsSync(home) || !statSync(home).isDirectory()) {
      rmSync(base, { recursive: true, force: true })
      return
    }
    const found = findComposeFolders(home)
    mkdirSync(join(base, 'plans'), { recursive: true, mode: 0o755 })

    let budget = PLANS_PER_CYCLE
    for (const folder of found) {
      const known = planned.get(folder.path)
      const due = !known || known.modifiedAt !== folder.modifiedAt || now - known.at >= REPLAN_MS
      if (due && budget > 0) {
        budget -= 1
        planned.set(folder.path, { at: now, modifiedAt: folder.modifiedAt, plan: await planFolder(root, home, folder) })
      }
    }

    const keep = new Set<string>()
    const folders: DiscoveredFolder[] = found.map((folder) => {
      const plan = planned.get(folder.path)?.plan ?? null
      if (plan) {
        keep.add(fileKey(folder.path))
        writeAtomic(join(base, 'plans', fileKey(folder.path)), `${JSON.stringify(plan)}\n`)
      }
      return {
        path: folder.path,
        composeFile: folder.composeFile,
        services: plan ? plan.services.length : null,
        modifiedAt: folder.modifiedAt,
        adopted: plan?.adopted ?? false,
        planned: plan !== null,
      }
    })
    for (const name of readdirSync(join(base, 'plans'))) {
      if (!keep.has(name) && !name.startsWith('.')) rmSync(join(base, 'plans', name), { force: true })
    }
    for (const path of [...planned.keys()]) if (!found.some((folder) => folder.path === path)) planned.delete(path)
    const index: DiscoveredFolders = { version: 1, home, collectedAt: Math.floor(now / 1000), folders }
    writeAtomic(join(base, 'folders.json'), `${JSON.stringify(index)}\n`)
  } catch {
    // Discovery that failed is discovery that is not there.
  }
}
