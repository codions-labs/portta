// The folders on the host that look like projects, and what adopting each would do.
//
// The panel never opens Projects Home (ADR 0031) and cannot ask the host to. The collector, which
// runs on the host, finds the folders that hold a Compose file and runs the same read-only analysis
// `portta analyze` does, and publishes the result under state/discovery/. The panel reads that, so
// the only folders it can show or review are ones the collector found itself. See
// docs/development/adr/0059-the-collector-finds-and-reviews-project-folders.md.

export const DISCOVERY_MAX_DEPTH = 3
export const DISCOVERY_MAX_FOLDERS = 200

export interface DiscoveredFolder {
  /** Relative to Projects Home, with forward slashes. Never absolute and never climbing. */
  path: string
  composeFile: string
  services: number | null
  /** Seconds since the epoch, of the Compose file. */
  modifiedAt: number
  /** The folder already has a Portta overlay. */
  adopted: boolean
  /** Whether a plan was published for it. */
  planned: boolean
}

export interface DiscoveredFolders {
  version: 1
  home: string
  collectedAt: number
  folders: DiscoveredFolder[]
}

export interface PlannedService {
  name: string
  image: string | null
  kind: string
  /** The port Portta would route to, when the service speaks HTTP. */
  port: string | null
  publishedPorts: Array<{ host: string; container: string }>
  containerName: string | null
}

export interface FolderPlan {
  version: 1
  path: string
  composeFile: string
  project: { name: string; source: string }
  domain: string
  adopted: boolean
  services: PlannedService[]
  findings: {
    publishedHostPorts: string[]
    fixedContainerNames: string[]
    publishedDatastores: string[]
    implicitNamespace: boolean
    containerNameCollisions: Array<{ service: string; containerName: string; usedBy: string }>
    namespaceInUse: { project: string; workingDirs: string[] } | null
  }
  collectedAt: number
}

/** A folder as the index may name it: relative, forward slashes, nothing hidden or climbing. */
export function isDiscoverablePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\0') || path.includes('\\')) return false
  return !path.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))
}

/** What the CLI prints for the same folder, so the review can be done in a terminal too. */
export function adoptCommand(
  folder: string,
  decisions: Record<string, 'protect' | 'public' | 'later'>,
  /** Projects Home as the collector published it, so the command names the folder that was reviewed. */
  home = '~/projects',
): string {
  const quote = (value: string) => (/^[A-Za-z0-9_./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`)
  const flags = Object.entries(decisions)
    .filter(([name, choice]) => choice !== 'later' && /^[A-Za-z0-9_.-]+$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, choice]) => `--${choice === 'protect' ? 'protect' : 'public'} ${name}`)
  return ['portta adopt', quote(`${home.replace(/\/+$/, '')}/${folder}`), ...flags].join(' ')
}
