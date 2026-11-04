// Cleaning the Docker host: networks, images, volumes and stopped containers.
//
// Two rules run through this file, and the second is the reason the first is
// enough to trust:
//   - the panel decides what may go, never the browser. Every removal starts
//     from a fresh read of the host and is refused here when the resource is
//     Portta's, one of Docker's defaults, or still referenced by a container;
//   - a prune is not Docker's prune. The panel lists the candidates, drops the
//     protected ones and removes the rest one at a time, so one stubborn
//     resource is reported and the others still go (ADR 0060).
//
// Nothing is ever forced. Docker refusing a resource that is "in use" is the
// last line of defence and stays in force.

import type {
  DockerDiskUsage as DiskUsageSummary,
  DockerImageItem,
  DockerNetworkItem,
  DockerProtection,
  DockerPruneBody,
  DockerPruneResult,
  DockerResourceKind,
  DockerResourceOutcome,
  DockerResourceRemoveResult,
  DockerVolumeItem,
} from 'portta-contracts'
import type { PanelConfig } from '../config.ts'
import type { DockerClient } from './docker/client.ts'
import type { DockerDiskContainer, DockerDiskImage, DockerDiskVolume, DockerNetwork } from './docker/types.ts'
import { networkRole } from './inventory.ts'
import { LABELS } from './labels.ts'

/** Docker's own networks. Removing one is either impossible or breaks every container. */
const DOCKER_NETWORKS = new Set(['bridge', 'host', 'none', 'ingress', 'docker_gwbridge'])

/**
 * Images the stack runs on. Matched by repository, so a version bump does not
 * unprotect them. They are in use whenever the stack is up; this is for the
 * moment it is down and `portta up` would have to pull them again.
 */
const PORTTA_IMAGE_REPOS = new Set([
  'ghcr.io/codions-labs/portta',
  'codions-labs/portta',
  'traefik',
  'tailscale/tailscale',
  'cloudflare/cloudflared',
  'tecnativa/docker-socket-proxy',
])

const ANONYMOUS_VOLUME = /^[a-f0-9]{64}$/
const STOPPED = new Set(['exited', 'dead', 'created'])

interface HostView {
  config: PanelConfig
  networks: DockerNetwork[]
  images: DockerDiskImage[]
  volumes: DockerDiskVolume[]
  containers: DockerDiskContainer[]
  layersSize: number
  buildCacheBytes: number
}

async function readHost(client: DockerClient, config: PanelConfig): Promise<HostView> {
  const [df, networks] = await Promise.all([client.diskUsage(), client.listNetworks()])
  return {
    config,
    networks,
    images: df.Images ?? [],
    volumes: df.Volumes ?? [],
    containers: df.Containers ?? [],
    layersSize: df.LayersSize ?? 0,
    buildCacheBytes: (df.BuildCache ?? []).reduce((sum, entry) => sum + Math.max(0, entry.Size ?? 0), 0),
  }
}

const isManaged = (labels: Record<string, string> | null | undefined) => labels?.[LABELS.managed] === 'true'
const containerName = (container: DockerDiskContainer) => (container.Names?.[0] ?? container.Id).replace(/^\//, '')
const repoOf = (tag: string) => {
  // `localhost:5000/app:1` has a colon in the host part: the tag is after the last slash.
  const slash = tag.lastIndexOf('/')
  const colon = tag.indexOf(':', slash + 1)
  return colon === -1 ? tag : tag.slice(0, colon)
}
const cleanId = (id: string) => id.replace(/^sha256:/, '')
const clamp = (size: number | undefined) => (size === undefined || size < 0 ? null : size)

/** The containers still around once the ones a prune is about to remove are gone. */
function remaining(host: HostView, gone: ReadonlySet<string>) {
  return host.containers.filter((container) => !gone.has(container.Id))
}

// -- networks ----------------------------------------------------------------

function networkProtection(
  network: DockerNetwork,
  host: HostView,
  alive: DockerDiskContainer[],
): DockerProtection | null {
  const { config } = host
  if (DOCKER_NETWORKS.has(network.Name) || network.Driver === 'host' || network.Driver === 'null') return 'docker'
  const own = [config.network, config.controlNetwork, config.accessNetwork, config.webNetwork]
  const users = alive.filter((container) => network.Name in (container.NetworkSettings?.Networks ?? {}))
  if (
    own.includes(network.Name) ||
    isManaged(network.Labels) ||
    network.Labels?.[LABELS.composeProject] === config.projectName ||
    users.some((container) => isManaged(container.Labels))
  ) {
    return 'portta'
  }
  return users.length > 0 ? 'in-use' : null
}

function networkItems(host: HostView, gone: ReadonlySet<string> = new Set()): DockerNetworkItem[] {
  const alive = remaining(host, gone)
  return host.networks
    .map((network) => ({
      id: network.Id,
      name: network.Name,
      driver: network.Driver,
      scope: network.Scope,
      internal: network.Internal,
      containerCount: alive.filter((container) => network.Name in (container.NetworkSettings?.Networks ?? {})).length,
      role: networkRole(network.Name, host.config),
      project: network.Labels?.[LABELS.composeProject] ?? null,
      protection: networkProtection(network, host, alive),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// -- images ------------------------------------------------------------------

function imageProtection(
  image: DockerDiskImage,
  host: HostView,
  alive: DockerDiskContainer[],
): DockerProtection | null {
  const tags = realTags(image)
  const users = alive.filter((container) => container.ImageID === image.Id)
  const bridge = repoOf(host.config.bridgeImage)
  if (
    users.some((container) => isManaged(container.Labels)) ||
    tags.some((tag) => PORTTA_IMAGE_REPOS.has(repoOf(tag)) || repoOf(tag) === bridge)
  ) {
    return 'portta'
  }
  return users.length > 0 ? 'in-use' : null
}

const realTags = (image: DockerDiskImage) => (image.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>')

function imageItems(host: HostView, gone: ReadonlySet<string> = new Set()): DockerImageItem[] {
  const alive = remaining(host, gone)
  return host.images
    .map((image) => {
      const tags = realTags(image)
      return {
        id: cleanId(image.Id),
        tags,
        dangling: tags.length === 0,
        sizeBytes: Math.max(0, image.Size),
        uniqueBytes: image.SharedSize >= 0 ? Math.max(0, image.Size - image.SharedSize) : null,
        createdAt: image.Created,
        containerCount: alive.filter((container) => container.ImageID === image.Id).length,
        protection: imageProtection(image, host, alive),
      }
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes || a.id.localeCompare(b.id))
}

// -- volumes -----------------------------------------------------------------

function volumeProtection(
  volume: DockerDiskVolume,
  host: HostView,
  alive: DockerDiskContainer[],
): DockerProtection | null {
  const users = alive.filter((container) => (container.Mounts ?? []).some((mount) => mount.Name === volume.Name))
  if (
    isManaged(volume.Labels) ||
    volume.Labels?.[LABELS.composeProject] === host.config.projectName ||
    // A component that is stopped still owns its data: the volume is mounted by
    // a container that merely is not running, and `alive` keeps it.
    users.some((container) => isManaged(container.Labels))
  ) {
    return 'portta'
  }
  return users.length > 0 ? 'in-use' : null
}

function volumeItems(host: HostView, gone: ReadonlySet<string> = new Set()): DockerVolumeItem[] {
  const alive = remaining(host, gone)
  return host.volumes
    .map((volume) => {
      const created = volume.CreatedAt ? Math.floor(Date.parse(volume.CreatedAt) / 1000) : Number.NaN
      return {
        name: volume.Name,
        driver: volume.Driver,
        sizeBytes: clamp(volume.UsageData?.Size),
        createdAt: Number.isFinite(created) ? created : null,
        containerCount: alive.filter((container) =>
          (container.Mounts ?? []).some((mount) => mount.Name === volume.Name),
        ).length,
        anonymous: ANONYMOUS_VOLUME.test(volume.Name),
        project: volume.Labels?.[LABELS.composeProject] ?? null,
        protection: volumeProtection(volume, host, alive),
      }
    })
    .sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || a.name.localeCompare(b.name))
}

// -- reading -----------------------------------------------------------------

export async function listNetworks(client: DockerClient, config: PanelConfig) {
  return { networks: networkItems(await readHost(client, config)) }
}

export async function listImages(client: DockerClient, config: PanelConfig) {
  const host = await readHost(client, config)
  const images = imageItems(host)
  return {
    images,
    totalBytes: Math.max(0, host.layersSize),
    reclaimableBytes: images
      .filter((image) => image.protection === null && image.containerCount === 0)
      .reduce((sum, image) => sum + (image.uniqueBytes ?? 0), 0),
  }
}

export async function listVolumes(client: DockerClient, config: PanelConfig) {
  const volumes = volumeItems(await readHost(client, config))
  return {
    volumes,
    totalBytes: volumes.reduce((sum, volume) => sum + (volume.sizeBytes ?? 0), 0),
    reclaimableBytes: volumes
      .filter((volume) => volume.protection === null)
      .reduce((sum, volume) => sum + (volume.sizeBytes ?? 0), 0),
  }
}

function stoppedContainers(host: HostView) {
  return host.containers.filter((container) => STOPPED.has(container.State) && !isManaged(container.Labels))
}

export async function diskUsage(client: DockerClient, config: PanelConfig): Promise<DiskUsageSummary> {
  const host = await readHost(client, config)
  const stopped = new Set(stoppedContainers(host).map((container) => container.Id))
  // What a prune would find once the stopped containers are gone is what the
  // numbers promise, so the counts are taken from that same point of view.
  const images = imageItems(host, stopped)
  const volumes = volumeItems(host, stopped)
  const free = <T extends { protection: DockerProtection | null }>(rows: T[]) =>
    rows.filter((row) => row.protection === null)
  const freeImages = free(images)
  const freeVolumes = free(volumes)
  const dangling = freeImages.filter((image) => image.dangling)
  const anonymous = freeVolumes.filter((volume) => volume.anonymous)
  const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0)
  return {
    containers: { total: host.containers.length, stopped: stopped.size },
    networks: {
      total: host.networks.length,
      unused: free(networkItems(host, stopped)).length,
    },
    images: {
      total: images.length,
      totalBytes: Math.max(0, host.layersSize),
      dangling: dangling.length,
      danglingBytes: sum(dangling, (image) => image.uniqueBytes ?? 0),
      unused: freeImages.length,
      unusedBytes: sum(freeImages, (image) => image.uniqueBytes ?? 0),
    },
    volumes: {
      total: volumes.length,
      totalBytes: sum(volumes, (volume) => volume.sizeBytes ?? 0),
      anonymous: anonymous.length,
      anonymousBytes: sum(anonymous, (volume) => volume.sizeBytes ?? 0),
      unused: freeVolumes.length,
      unusedBytes: sum(freeVolumes, (volume) => volume.sizeBytes ?? 0),
    },
    buildCacheBytes: host.buildCacheBytes,
  }
}

// -- removing ----------------------------------------------------------------

const WHY: Record<DockerProtection, string> = {
  portta: 'it belongs to Portta, and removing it could take the panel or the gateway down',
  docker: "it is one of Docker's own default networks",
  'in-use': 'a container still uses it; remove the container first',
}

function outcome(
  kind: DockerResourceKind,
  id: string,
  name: string,
  result: { ok: boolean; skipped?: boolean; reason?: string | null; sizeBytes?: number | null },
): DockerResourceOutcome {
  return {
    kind,
    id,
    name,
    ok: result.ok,
    skipped: result.skipped ?? false,
    reason: result.reason ?? null,
    sizeBytes: result.sizeBytes ?? null,
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function attempt(
  kind: DockerResourceKind,
  id: string,
  name: string,
  sizeBytes: number | null,
  run: () => Promise<void>,
): Promise<DockerResourceOutcome> {
  try {
    await run()
    return outcome(kind, id, name, { ok: true, sizeBytes })
  } catch (error) {
    return outcome(kind, id, name, { ok: false, reason: reasonOf(error), sizeBytes })
  }
}

function tally(results: DockerResourceOutcome[]): Omit<DockerResourceRemoveResult, 'results'> {
  return {
    removed: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok && !entry.skipped).length,
    skipped: results.filter((entry) => entry.skipped).length,
    freedBytes: results.reduce((sum, entry) => sum + (entry.ok ? (entry.sizeBytes ?? 0) : 0), 0),
  }
}

const gone = (kind: DockerResourceKind, id: string) =>
  outcome(kind, id, id, { ok: false, skipped: true, reason: 'it is not on this host any more' })

const refused = (kind: DockerResourceKind, id: string, name: string, why: DockerProtection) =>
  outcome(kind, id, name, { ok: false, skipped: true, reason: WHY[why] })

export async function removeNetworks(
  client: DockerClient,
  config: PanelConfig,
  ids: string[],
): Promise<DockerResourceRemoveResult> {
  const items = networkItems(await readHost(client, config))
  const results: DockerResourceOutcome[] = []
  for (const id of new Set(ids)) {
    const item = items.find((candidate) => candidate.id === id)
    if (!item) results.push(gone('network', id))
    else if (item.protection) results.push(refused('network', id, item.name, item.protection))
    else results.push(await attempt('network', id, item.name, null, () => client.removeNetwork(item.id)))
  }
  return { ...tally(results), results }
}

/** Removes every tag when there are several, and the id when there are none. */
async function dropImage(client: DockerClient, image: DockerImageItem): Promise<void> {
  if (image.tags.length === 0) {
    await client.removeImage(image.id)
    return
  }
  for (const tag of image.tags) await client.removeImage(tag)
}

export async function removeImages(
  client: DockerClient,
  config: PanelConfig,
  ids: string[],
): Promise<DockerResourceRemoveResult> {
  const items = imageItems(await readHost(client, config))
  const results: DockerResourceOutcome[] = []
  for (const requested of new Set(ids)) {
    const id = cleanId(requested)
    const item = items.find((candidate) => candidate.id === id)
    const label = (image: DockerImageItem) => image.tags[0] ?? image.id.slice(0, 12)
    if (!item) results.push(gone('image', id))
    else if (item.protection) results.push(refused('image', item.id, label(item), item.protection))
    else results.push(await attempt('image', item.id, label(item), item.uniqueBytes, () => dropImage(client, item)))
  }
  return { ...tally(results), results }
}

export async function removeVolumes(
  client: DockerClient,
  config: PanelConfig,
  names: string[],
): Promise<DockerResourceRemoveResult> {
  const items = volumeItems(await readHost(client, config))
  const results: DockerResourceOutcome[] = []
  for (const name of new Set(names)) {
    const item = items.find((candidate) => candidate.name === name)
    if (!item) results.push(gone('volume', name))
    else if (item.protection) results.push(refused('volume', name, name, item.protection))
    else results.push(await attempt('volume', name, name, item.sizeBytes, () => client.removeVolume(name)))
  }
  return { ...tally(results), results }
}

// -- prune -------------------------------------------------------------------

/**
 * Sweeps what nothing uses.
 *
 * Containers go first, because removing a stopped container is what frees its
 * network, its image and its anonymous volumes; each phase then reads the host
 * again. A dry run cannot do that, so it asks the same questions about the host
 * *as if* the stopped containers were already gone, which gives the same list.
 */
export async function prune(
  client: DockerClient,
  config: PanelConfig,
  body: Omit<DockerPruneBody, 'confirm'>,
): Promise<DockerPruneResult> {
  const items: DockerResourceOutcome[] = []
  const planned = (host: HostView) => new Set(body.containers ? stoppedContainers(host).map((entry) => entry.Id) : [])

  if (body.dryRun) {
    const host = await readHost(client, config)
    const goneIds = planned(host)
    for (const container of stoppedContainers(host).filter((entry) => goneIds.has(entry.Id))) {
      items.push(outcome('container', container.Id, containerName(container), { ok: true }))
    }
    items.push(...candidates(host, body, goneIds))
    return summary(true, items)
  }

  if (body.containers) {
    const host = await readHost(client, config)
    for (const container of stoppedContainers(host)) {
      items.push(
        await attempt('container', container.Id, containerName(container), null, () =>
          client.remove(container.Id, false),
        ),
      )
    }
  }
  if (body.networks) {
    const host = await readHost(client, config)
    for (const network of networkItems(host).filter((entry) => entry.protection === null)) {
      items.push(await attempt('network', network.id, network.name, null, () => client.removeNetwork(network.id)))
    }
  }
  if (body.images !== 'none') {
    const host = await readHost(client, config)
    const found = imageItems(host).filter((image) => pickImage(image, body.images))
    for (const image of found) {
      const label = image.tags[0] ?? image.id.slice(0, 12)
      items.push(await attempt('image', image.id, label, image.uniqueBytes, () => dropImage(client, image)))
    }
  }
  if (body.volumes !== 'none') {
    const host = await readHost(client, config)
    for (const volume of volumeItems(host).filter((entry) => pickVolume(entry, body.volumes))) {
      items.push(
        await attempt('volume', volume.name, volume.name, volume.sizeBytes, () => client.removeVolume(volume.name)),
      )
    }
  }
  return summary(false, items)
}

const pickImage = (image: DockerImageItem, mode: DockerPruneBody['images']) =>
  image.protection === null &&
  image.containerCount === 0 &&
  (mode === 'unused' || (mode === 'dangling' && image.dangling))

const pickVolume = (volume: DockerVolumeItem, mode: DockerPruneBody['volumes']) =>
  volume.protection === null &&
  volume.containerCount === 0 &&
  (mode === 'unused' || (mode === 'anonymous' && volume.anonymous))

function candidates(
  host: HostView,
  body: Pick<DockerPruneBody, 'networks' | 'images' | 'volumes'>,
  goneIds: ReadonlySet<string>,
): DockerResourceOutcome[] {
  const rows: DockerResourceOutcome[] = []
  if (body.networks) {
    for (const network of networkItems(host, goneIds).filter((entry) => entry.protection === null)) {
      rows.push(outcome('network', network.id, network.name, { ok: true }))
    }
  }
  for (const image of imageItems(host, goneIds).filter((entry) => pickImage(entry, body.images))) {
    rows.push(
      outcome('image', image.id, image.tags[0] ?? image.id.slice(0, 12), { ok: true, sizeBytes: image.uniqueBytes }),
    )
  }
  for (const volume of volumeItems(host, goneIds).filter((entry) => pickVolume(entry, body.volumes))) {
    rows.push(outcome('volume', volume.name, volume.name, { ok: true, sizeBytes: volume.sizeBytes }))
  }
  return rows
}

function summary(dryRun: boolean, items: DockerResourceOutcome[]): DockerPruneResult {
  return {
    dryRun,
    removed: items.filter((entry) => entry.ok).length,
    failed: items.filter((entry) => !entry.ok).length,
    freedBytes: items.reduce((sum, entry) => sum + (entry.ok ? (entry.sizeBytes ?? 0) : 0), 0),
    items,
  }
}
