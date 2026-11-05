// The server's own health, read by the panel itself.
//
// On a Linux host the panel's container shares the kernel's view of memory, CPU,
// load and uptime (`/proc/meminfo`, `/proc/stat`, `/proc/loadavg` and
// `/proc/uptime` are not namespaced), the disk of the state folder it mounts is
// the host's disk, and Docker already answers for the machine (`/info`) and for
// every container (`stats`, `system/df`) through the proxy the panel owns. So
// nothing has to run on the host for the numbers to be live, and nothing has to
// be started again after a reboot: Docker brings the panel back, and the panel
// reads.
//
// The host collector stays for what only the host can read (git, project files,
// folders, a GPU, a battery) and wins whenever it is writing: this is the floor
// under it, not a second opinion. It does not apply where the panel's container
// lives in a VM (Docker Desktop, OrbStack on a Mac): there `/proc` is the VM's.

import { readFileSync, statfsSync } from 'node:fs'
import {
  aggregateProjects,
  type ContainerIdentity,
  type ContainerResourceMetrics,
  type DockerStorage,
  detectRuntime,
  emptyHost,
  emptySnapshot,
  type HostMetrics,
  type HostStorageInfo,
  historyPointFrom,
  type MetricsHistoryPoint,
  type MetricsSnapshot,
  serviceOf,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { DockerClient } from './docker/client.ts'
import type { DockerDiskUsage, DockerInfo, DockerStats } from './docker/types.ts'
import { LABELS } from './labels.ts'

const HOST_INTERVAL_MS = 3_000
const CONTAINERS_INTERVAL_MS = 10_000
const INFO_INTERVAL_MS = 60_000
const STORAGE_INTERVAL_MS = 5 * 60_000
const HISTORY_INTERVAL_MS = 15_000
const HISTORY_KEEP_SECONDS = 60 * 60
/** A Docker call that has not answered by then is given up on, so one hung request cannot hold the sampler. */
const CALL_TIMEOUT_MS = 8_000
/** How many `docker stats` are in flight at once: each one holds a second open. */
const STATS_CONCURRENCY = 6

// -- what /proc says ----------------------------------------------------------

const KIB = 1024

function field(text: string, name: string): number | null {
  const match = new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)
  return match ? Number(match[1]) * KIB : null
}

/** Memory as the kernel counts what a program could still get: `MemAvailable`, not `MemFree`. */
export function parseMeminfo(text: string): {
  totalBytes: number
  availableBytes: number
  swapTotalBytes: number
  swapUsedBytes: number
} | null {
  const total = field(text, 'MemTotal')
  if (total === null || total <= 0) return null
  const available =
    field(text, 'MemAvailable') ??
    (field(text, 'MemFree') ?? 0) + (field(text, 'Buffers') ?? 0) + (field(text, 'Cached') ?? 0)
  const swapTotal = field(text, 'SwapTotal') ?? 0
  return {
    totalBytes: total,
    availableBytes: Math.min(total, available),
    swapTotalBytes: swapTotal,
    swapUsedBytes: Math.max(0, swapTotal - (field(text, 'SwapFree') ?? swapTotal)),
  }
}

export interface CpuTimes {
  busy: number
  total: number
}

/** The aggregate `cpu` line. Guest time is already inside user time, so only the first eight columns count. */
export function parseCpuTimes(text: string): CpuTimes | null {
  const line = text.split('\n').find((row) => /^cpu\s/.test(row))
  if (!line) return null
  const columns = line.trim().split(/\s+/).slice(1, 9).map(Number)
  if (columns.length < 4 || columns.some((value) => !Number.isFinite(value))) return null
  const total = columns.reduce((sum, value) => sum + value, 0)
  // idle and iowait are the time nothing wanted the processor.
  const idle = (columns[3] ?? 0) + (columns[4] ?? 0)
  return { busy: total - idle, total }
}

/** How much of the processor was busy between two readings, 0 to 1. */
export function cpuBetween(previous: CpuTimes, current: CpuTimes): number | null {
  const elapsed = current.total - previous.total
  if (elapsed <= 0) return null
  return Math.min(1, Math.max(0, (current.busy - previous.busy) / elapsed))
}

export function parseLoadavg(text: string): { one: number; five: number; fifteen: number } | null {
  const [one, five, fifteen] = text.trim().split(/\s+/).slice(0, 3).map(Number)
  if ([one, five, fifteen].some((value) => value === undefined || !Number.isFinite(value))) return null
  return { one: one as number, five: five as number, fifteen: fifteen as number }
}

export function parseUptime(text: string): number | null {
  const seconds = Number(text.trim().split(/\s+/)[0])
  return Number.isFinite(seconds) ? Math.floor(seconds) : null
}

export function parseCpuModel(text: string): string | null {
  return /^model name\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null
}

// -- what Docker says ---------------------------------------------------------

/** Docker answers `x86_64`; everything else in the panel says `x64`. */
function architectureOf(value: string | undefined): string | null {
  if (!value) return null
  return { x86_64: 'x64', aarch64: 'arm64', amd64: 'x64' }[value.toLowerCase()] ?? value
}

/** `Debian GNU/Linux 13 (trixie)` is a name and a version. */
export function distroOf(operatingSystem: string | undefined): { distro: string | null; version: string | null } {
  if (!operatingSystem) return { distro: null, version: null }
  const match = /^(.*?)\s+(\d[\w.]*)(?:\s+.*)?$/.exec(operatingSystem.trim())
  return match
    ? { distro: match[1] ?? null, version: match[2] ?? null }
    : { distro: operatingSystem.trim(), version: null }
}

/**
 * Whether `/proc` here is the host's. Docker Desktop and OrbStack run the engine in
 * a VM, and there the panel would be reading the VM and calling it the machine.
 */
export function readsTheHost(info: DockerInfo | null, platform: string = process.platform): boolean {
  if (!info || platform !== 'linux') return false
  if ((info.OSType ?? 'linux') !== 'linux') return false
  return (
    detectRuntime(info.OperatingSystem ?? null) === 'docker-engine' &&
    !/^(docker-desktop|orbstack|colima)$/i.test(info.Name)
  )
}

/** One sample of one container. CPU needs the sample before it, which Docker puts inside the same answer. */
export function containerFromStats(
  stats: DockerStats,
  identity: { id: string; name: string; service: string | null },
): ContainerResourceMetrics {
  const cpu = stats.cpu_stats
  const before = stats.precpu_stats
  const used = (cpu?.cpu_usage?.total_usage ?? 0) - (before?.cpu_usage?.total_usage ?? 0)
  const system = (cpu?.system_cpu_usage ?? 0) - (before?.system_cpu_usage ?? 0)
  // Cores, as `docker stats` prints it divided by 100: 4 busy cores read 4, not 1.
  const cores = system > 0 && used >= 0 ? (used / system) * (cpu?.online_cpus ?? 1) : null

  // What a container holds, without the file cache the kernel gives back on demand.
  const cache = stats.memory_stats?.stats?.inactive_file ?? stats.memory_stats?.stats?.total_inactive_file ?? 0
  const memory = stats.memory_stats?.usage === undefined ? null : Math.max(0, stats.memory_stats.usage - cache)
  const limit = stats.memory_stats?.limit

  const networks = Object.values(stats.networks ?? {})
  const sum = (pick: (entry: { rx_bytes?: number; tx_bytes?: number }) => number | undefined) =>
    networks.length === 0 ? null : networks.reduce((total, entry) => total + (pick(entry) ?? 0), 0)

  return {
    id: identity.id,
    name: identity.name,
    service: identity.service,
    cpuUtilisation: cores,
    memoryUsedBytes: memory,
    memoryLimitBytes: limit !== undefined && limit > 0 ? limit : null,
    memoryUsedPercent: memory !== null && limit ? Math.min(1, memory / limit) : null,
    networkRxBytes: sum((entry) => entry.rx_bytes),
    networkTxBytes: sum((entry) => entry.tx_bytes),
    blockReadBytes: null,
    blockWriteBytes: null,
    pids: stats.pids_stats?.current ?? null,
  }
}

/** What each Compose project keeps on the Docker disk: its volumes and the writable layers of its containers. */
export function storageFromDisk(df: DockerDiskUsage, now: number): DockerStorage {
  const byProject = new Map<string, { volumeBytes: number; layerBytes: number }>()
  const entry = (project: string) => {
    const found = byProject.get(project) ?? { volumeBytes: 0, layerBytes: 0 }
    byProject.set(project, found)
    return found
  }
  for (const volume of df.Volumes ?? []) {
    const project = volume.Labels?.[LABELS.composeProject]
    const size = volume.UsageData?.Size ?? -1
    if (project && size > 0) entry(project).volumeBytes += size
  }
  for (const container of df.Containers ?? []) {
    const project = container.Labels?.[LABELS.composeProject]
    if (project && (container.SizeRw ?? 0) > 0) entry(project).layerBytes += container.SizeRw ?? 0
  }
  return {
    collectedAt: now,
    projects: [...byProject.entries()].map(([composeProject, sizes]) => ({ composeProject, ...sizes })),
  }
}

// -- the disk -----------------------------------------------------------------

/** The filesystem under a folder the panel mounts from the host, the way `df` reads it. */
export function storageOf(path: string): HostStorageInfo | null {
  try {
    const stats = statfsSync(path)
    const block = Number(stats.bsize)
    const total = Number(stats.blocks) * block
    const free = Number(stats.bfree) * block
    const available = Number(stats.bavail) * block
    if (!(total > 0)) return null
    const used = Math.max(0, total - free)
    // `df`'s own percentage: used over what a person can write, not over the reserved blocks too.
    const reachable = used + available
    return {
      path,
      mount: path,
      filesystem: null,
      totalBytes: total,
      usedBytes: used,
      availableBytes: available,
      usedPercent: reachable > 0 ? Math.min(1, used / reachable) : 0,
    }
  } catch {
    return null
  }
}

// -- the sampler --------------------------------------------------------------

/** A signal that ends the request itself, so a Docker call that never answers frees its connection. */
const giveUpAfter = (ms = CALL_TIMEOUT_MS) => ({ signal: AbortSignal.timeout(ms) })

export interface LiveSources {
  /** `/proc/<name>` as text, or null when it cannot be read. */
  proc: (name: string) => string | null
  storage: (path: string) => HostStorageInfo | null
  platform: string
  now: () => number
}

const SYSTEM: LiveSources = {
  proc: (name) => {
    try {
      return readFileSync(`/proc/${name}`, 'utf8')
    } catch {
      return null
    }
  },
  storage: storageOf,
  platform: process.platform,
  now: () => Date.now(),
}

export class LiveMetrics {
  private timer: ReturnType<typeof setInterval> | null = null
  private info: DockerInfo | null = null
  private infoAt = 0
  private cpuTimes: CpuTimes | null = null
  private cpuUtilisation: number | null = null
  private containers: ContainerResourceMetrics[] = []
  private identities: ContainerIdentity[] = []
  private containersAt = 0
  private storage: DockerStorage | null = null
  private storageAt = 0
  private historyAt = 0
  private points: MetricsHistoryPoint[] = []
  private latest: MetricsSnapshot | null = null
  private busy = false

  private client: DockerClient
  private config: PanelConfig
  private sources: LiveSources

  constructor(client: DockerClient, config: PanelConfig, sources: LiveSources = SYSTEM) {
    this.client = client
    this.config = config
    this.sources = sources
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), HOST_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The newest reading, or null where the panel cannot see the machine. */
  snapshot(): MetricsSnapshot | null {
    return this.latest
  }

  history(sinceSeconds: number): MetricsHistoryPoint[] {
    return this.points.filter((point) => point.timestamp >= sinceSeconds)
  }

  /** One round. Public so a test can drive it without a clock. */
  async tick(): Promise<void> {
    // A slow round is skipped, never queued behind itself.
    if (this.busy) return
    this.busy = true
    try {
      const now = this.sources.now()
      if (this.info === null || now - this.infoAt >= INFO_INTERVAL_MS) {
        this.info = await this.client.info(giveUpAfter()).catch(() => null)
        this.infoAt = now
      }
      if (!readsTheHost(this.info, this.sources.platform)) {
        this.latest = null
        return
      }
      this.readHost()
      if (now - this.containersAt >= CONTAINERS_INTERVAL_MS) {
        this.containersAt = now
        await this.readContainers().catch(() => {})
      }
      if (now - this.storageAt >= STORAGE_INTERVAL_MS) {
        this.storageAt = now
        this.storage = storageFromDisk(await this.client.diskUsage(giveUpAfter(60_000)), Math.floor(now / 1000))
      }
      this.latest = this.build(now)
      this.remember(this.latest, now)
    } catch {
      // Docker unreachable for a moment: keep what was read, and let the age say so.
    } finally {
      this.busy = false
    }
  }

  private readHost(): void {
    const stat = this.sources.proc('stat')
    const times = stat ? parseCpuTimes(stat) : null
    if (!times) return
    if (this.cpuTimes) {
      // Between two readings only: the figure since boot is a long average and says nothing about now.
      const between = cpuBetween(this.cpuTimes, times)
      if (between !== null) this.cpuUtilisation = between
    }
    this.cpuTimes = times
  }

  private async readContainers(): Promise<void> {
    const listed = await this.client.listContainers(false, giveUpAfter())
    const identities: ContainerIdentity[] = listed.map((item) => ({
      id: item.Id,
      name: (item.Names[0] ?? item.Id).replace(/^\//, ''),
      labels: item.Labels ?? {},
    }))
    const metrics: ContainerResourceMetrics[] = []
    let next = 0
    const worker = async () => {
      while (next < identities.length) {
        const identity = identities[next++]
        if (!identity) return
        const stats = await this.client.stats(identity.id, { oneShot: false, ...giveUpAfter() }).catch(() => null)
        if (stats) metrics.push(containerFromStats(stats, { ...identity, service: serviceOf(identity.labels) }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(STATS_CONCURRENCY, identities.length) }, worker))
    this.containers = metrics
    this.identities = identities
  }

  private build(now: number): MetricsSnapshot {
    const at = Math.floor(now / 1000)
    const snapshot = emptySnapshot({ id: '', name: null, hostname: this.info?.Name ?? null }, at)
    snapshot.host = this.hostMetrics()
    snapshot.runtime = { name: 'docker-engine' }
    const own = this.config.projectName
    snapshot.projects = aggregateProjects(this.containers, this.identities).map((project) =>
      project.composeProject === own ? { ...project, own: true as const } : project,
    )
    snapshot.dockerStorage = this.storage
    return snapshot
  }

  private hostMetrics(): HostMetrics {
    const host = emptyHost()
    const info = this.info
    const memory = parseMeminfo(this.sources.proc('meminfo') ?? '')
    const system = distroOf(info?.OperatingSystem)
    const total = memory?.totalBytes ?? info?.MemTotal ?? null
    const used = memory ? memory.totalBytes - memory.availableBytes : null
    const model = parseCpuModel(this.sources.proc('cpuinfo') ?? '')

    host.hostname = info?.Name ?? null
    host.architecture = architectureOf(info?.Architecture)
    host.platform = 'linux'
    host.distro = system.distro
    host.version = system.version
    host.kernel = info?.KernelVersion ?? null
    host.uptimeSeconds = parseUptime(this.sources.proc('uptime') ?? '')
    host.cpu = { ...host.cpu, brand: model, logicalCores: info?.NCPU ?? null }
    host.memoryTotalBytes = total
    host.memoryUsedBytes = used
    host.memoryAvailableBytes = memory?.availableBytes ?? null
    host.memoryUsedPercent = total && used !== null ? Math.min(1, Math.max(0, used / total)) : null
    host.swapTotalBytes = memory && memory.swapTotalBytes > 0 ? memory.swapTotalBytes : null
    host.swapUsedBytes = memory && memory.swapTotalBytes > 0 ? memory.swapUsedBytes : null
    host.cpuUtilisation = this.cpuUtilisation
    host.cpuIdle = this.cpuUtilisation === null ? null : 1 - this.cpuUtilisation
    host.load = parseLoadavg(this.sources.proc('loadavg') ?? '')
    host.storage = this.sources.storage(this.config.metricsDir)
    return host
  }

  private remember(snapshot: MetricsSnapshot, now: number): void {
    if (now - this.historyAt < HISTORY_INTERVAL_MS) return
    this.historyAt = now
    this.points.push(historyPointFrom(snapshot))
    const keep = Math.floor(now / 1000) - HISTORY_KEEP_SECONDS
    this.points = this.points.filter((point) => point.timestamp >= keep)
  }
}

// One per panel process, set when it starts. A test that never starts one reads the files alone.
let running: LiveMetrics | null = null

/** Made at boot and started with the panel's other jobs, so it also stops with them. */
export function createLiveMetrics(client: DockerClient, config: PanelConfig): LiveMetrics {
  running?.stop()
  running = new LiveMetrics(client, config)
  return running
}

export function liveMetrics(): LiveMetrics | null {
  return running
}
