// Normalized host metrics. The CLI writes these after talking to
// systeminformation and Docker; the panel only reads the JSON. Nothing here
// opens a path or imports the library — fixtures stay kernel-free.

export const METRICS_VERSION = 1
export const COLLECT_INTERVAL_MS = 5_000
export const HISTORY_INTERVAL_MS = 15_000
export const HISTORY_RETENTION_SECONDS = 60 * 60
export const STALE_AFTER_SECONDS = 30

export type RuntimeName = 'orbstack' | 'docker-desktop' | 'docker-engine' | 'unknown'

export interface MetricsInstance {
  id: string
  name: string | null
  hostname: string | null
}

export interface HostCpuInfo {
  manufacturer: string | null
  brand: string | null
  physicalCores: number | null
  logicalCores: number | null
  speed: number | null
  speedMax: number | null
}

export interface HostGpuInfo {
  vendor: string | null
  model: string
  vramBytes: number | null
  utilisation: number | null
  temperature: number | null
}

/**
 * A laptop is a host too. When Portta runs on one, whether it is on mains and
 * how much charge is left change what it is reasonable to start, so they are
 * metrics rather than trivia. A server reports `hasBattery: false` and the
 * panel shows nothing.
 */
export interface HostBatteryInfo {
  /** Always true: a host with no battery reports `battery: null` instead. */
  hasBattery: true
  /** 0-1, like every other ratio here. */
  percent: number | null
  charging: boolean
  acConnected: boolean
  minutesRemaining: number | null
  cycleCount: number | null
}

export interface HostStorageInfo {
  path: string
  mount: string | null
  filesystem: string | null
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usedPercent: number
}

export interface HostLoad {
  one: number
  five: number
  fifteen: number
}

/** What a person would call the machine, when the hardware says. */
export const HOST_KINDS = ['notebook', 'desktop', 'server', 'vm'] as const
export type HostKind = (typeof HOST_KINDS)[number]

export interface HostMetrics {
  hostname: string | null
  manufacturer: string | null
  model: string | null
  /** The commercial name, where the platform reports a trustworthy one (macOS so far). */
  productName: string | null
  /** From the chassis, the hypervisor flag and the battery; null when none of them say. */
  kind: HostKind | null
  architecture: string | null
  virtual: boolean | null
  platform: string | null
  distro: string | null
  version: string | null
  release: string | null
  kernel: string | null
  uptimeSeconds: number | null
  cpu: HostCpuInfo
  memoryTotalBytes: number | null
  memoryUsedBytes: number | null
  memoryAvailableBytes: number | null
  memoryUsedPercent: number | null
  swapTotalBytes: number | null
  swapUsedBytes: number | null
  cpuUtilisation: number | null
  cpuIdle: number | null
  load: HostLoad | null
  storage: HostStorageInfo | null
  gpu: HostGpuInfo[]
  /** CPU package temperature in Celsius, where the platform reports one. */
  temperatureCelsius: number | null
  battery: HostBatteryInfo | null
}

export interface ContainerResourceMetrics {
  id: string
  name: string
  service: string | null
  cpuUtilisation: number | null
  memoryUsedBytes: number | null
  memoryLimitBytes: number | null
  memoryUsedPercent: number | null
  networkRxBytes: number | null
  networkTxBytes: number | null
  blockReadBytes: number | null
  blockWriteBytes: number | null
  pids: number | null
}

export interface ProjectResourceMetrics {
  id: string
  name: string
  composeProject: string
  cpuUtilisation: number | null
  memoryUsedBytes: number | null
  containerCount: number
  networkRxBytes: number | null
  networkTxBytes: number | null
  containers: ContainerResourceMetrics[]
}

export interface MetricsSnapshot {
  version: typeof METRICS_VERSION
  instance: MetricsInstance
  collectedAt: number
  host: HostMetrics
  runtime: { name: RuntimeName } | null
  projects: ProjectResourceMetrics[]
}

export interface MetricsHistoryPoint {
  timestamp: number
  host: {
    cpuUtilisation: number | null
    memoryUsedBytes: number | null
    memoryUsedPercent: number | null
    storageUsedPercent: number | null
    load: HostLoad | null
    gpuUtilisation: number | null
    temperatureCelsius: number | null
  }
  projects: Array<{
    id: string
    cpuUtilisation: number | null
    memoryUsedBytes: number | null
  }>
  containers: Array<{
    id: string
    cpuUtilisation: number | null
    memoryUsedBytes: number | null
  }>
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function ratio(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null
  const value = used / total
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null
}

/** SI reports CPU as 0–100. Stored as 0–1. Zero is a real idle reading. */
export function percentToUnit(value: number | null): number | null {
  if (value === null) return null
  return Math.min(1, Math.max(0, value / 100))
}

export function emptyHost(): HostMetrics {
  return {
    hostname: null,
    manufacturer: null,
    model: null,
    productName: null,
    kind: null,
    architecture: null,
    virtual: null,
    platform: null,
    distro: null,
    version: null,
    release: null,
    kernel: null,
    uptimeSeconds: null,
    cpu: {
      manufacturer: null,
      brand: null,
      physicalCores: null,
      logicalCores: null,
      speed: null,
      speedMax: null,
    },
    memoryTotalBytes: null,
    memoryUsedBytes: null,
    memoryAvailableBytes: null,
    memoryUsedPercent: null,
    swapTotalBytes: null,
    swapUsedBytes: null,
    cpuUtilisation: null,
    cpuIdle: null,
    load: null,
    storage: null,
    gpu: [],
    temperatureCelsius: null,
    battery: null,
  }
}

export function emptySnapshot(instance: MetricsInstance, collectedAt: number): MetricsSnapshot {
  return {
    version: METRICS_VERSION,
    instance,
    collectedAt,
    host: emptyHost(),
    runtime: null,
    projects: [],
  }
}

export interface RawMount {
  fs?: unknown
  type?: unknown
  size?: unknown
  used?: unknown
  available?: unknown
  use?: unknown
  mount?: unknown
}

const SKIP_FS = /^(tmpfs|devtmpfs|overlay|shm|proc|sysfs|cgroup|cgroup2|squashfs|devfs|autofs)$/i

/**
 * The filesystem that actually holds `path`. Longest matching mount wins.
 * Overlay/tmpfs lose to a real disk on the same prefix when one exists.
 */
export function filesystemForPath(path: string, mounts: RawMount[]): HostStorageInfo | null {
  if (path === '') return null
  const candidates: Array<{ mount: RawMount; mountPath: string; skip: boolean }> = []
  for (const mount of mounts) {
    const mountPath = asNonEmptyString(mount.mount)
    const totalBytes = asFiniteNumber(mount.size)
    if (!mountPath || totalBytes === null || totalBytes <= 0) continue
    const prefix = mountPath === '/' ? '/' : mountPath.replace(/\/+$/, '')
    const matches = path === prefix || path.startsWith(`${prefix}/`) || prefix === '/'
    if (!matches) continue
    const kind = asNonEmptyString(mount.type) ?? ''
    candidates.push({ mount, mountPath: prefix, skip: SKIP_FS.test(kind) })
  }
  if (candidates.length === 0) return null
  candidates.sort((left, right) => {
    if (left.skip !== right.skip) return left.skip ? 1 : -1
    return right.mountPath.length - left.mountPath.length
  })
  const chosen = candidates[0]
  if (!chosen) return null
  const totalBytes = asFiniteNumber(chosen.mount.size)
  if (totalBytes === null || totalBytes <= 0) return null
  const availableBytes = asFiniteNumber(chosen.mount.available)
  const usedBytes =
    asFiniteNumber(chosen.mount.used) ?? (availableBytes !== null ? Math.max(0, totalBytes - availableBytes) : null)
  const usedPercent =
    asFiniteNumber(chosen.mount.use) !== null
      ? percentToUnit(asFiniteNumber(chosen.mount.use))
      : ratio(usedBytes, totalBytes)
  if (usedBytes === null || availableBytes === null || usedPercent === null) return null
  return {
    path,
    mount: chosen.mountPath,
    filesystem: asNonEmptyString(chosen.mount.fs) ?? asNonEmptyString(chosen.mount.type),
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent,
  }
}

export function detectRuntime(os: string | null): RuntimeName {
  if (!os) return 'unknown'
  if (/orbstack/i.test(os)) return 'orbstack'
  if (/docker desktop/i.test(os)) return 'docker-desktop'
  return 'docker-engine'
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** SI quotes VRAM in MiB when the field is a small integer. */
function vramBytes(value: unknown): number | null {
  const raw = asFiniteNumber(value)
  if (raw === null || raw <= 0) return null
  return raw < 1_000_000 ? Math.round(raw * 1024 * 1024) : Math.round(raw)
}

function gpuUtilisation(controller: Record<string, unknown>): number | null {
  const present = controller.utilization ?? controller.utilisation
  if (present === undefined || present === null || present === '') return null
  const raw = asFiniteNumber(present)
  if (raw === null) return null
  return raw > 1 ? percentToUnit(raw) : Math.min(1, Math.max(0, raw))
}

export function normalizeGpus(graphics: unknown): HostGpuInfo[] {
  const root = record(graphics)
  const list = Array.isArray(root?.controllers) ? root.controllers : Array.isArray(graphics) ? graphics : []
  const gpus: HostGpuInfo[] = []
  for (const entry of list) {
    const controller = record(entry)
    if (!controller) continue
    const model = asNonEmptyString(controller.model) ?? asNonEmptyString(controller.name)
    if (!model) continue
    const temperature = asFiniteNumber(controller.temperature) ?? asFiniteNumber(controller.temp)
    gpus.push({
      vendor: asNonEmptyString(controller.vendor),
      model,
      vramBytes: vramBytes(controller.vram),
      utilisation: gpuUtilisation(controller),
      temperature: temperature !== null && temperature > 0 ? temperature : null,
    })
  }
  return gpus
}

/**
 * A plausible temperature only. Sensors that are absent report 0, and a host
 * whose CPU is at 0 °C or 200 °C is telling us it does not know.
 */
export function plausibleTemperature(value: unknown): number | null {
  const raw = asFiniteNumber(value)
  if (raw === null || raw <= 0 || raw > 150) return null
  return Math.round(raw * 10) / 10
}

export function normalizeTemperature(cpuTemperature: unknown, gpus: readonly HostGpuInfo[] = []): number | null {
  const sensor = record(cpuTemperature)
  const main = plausibleTemperature(sensor?.main)
  if (main !== null) return main
  const cores = Array.isArray(sensor?.cores)
    ? sensor.cores.map(plausibleTemperature).filter((value): value is number => value !== null)
    : []
  if (cores.length > 0) return Math.round(Math.max(...cores) * 10) / 10
  // A discrete GPU often carries the only sensor a desktop exposes.
  const fromGpu = gpus.map((gpu) => gpu.temperature).find((value) => value !== null)
  return fromGpu ?? null
}

export function normalizeBattery(battery: unknown): HostBatteryInfo | null {
  const raw = record(battery)
  if (!raw) return null
  if (raw.hasBattery !== true) return null
  const percent = asFiniteNumber(raw.percent)
  const minutes = asFiniteNumber(raw.timeRemaining)
  const cycles = asFiniteNumber(raw.cycleCount)
  return {
    hasBattery: true,
    percent: percent === null ? null : percentToUnit(percent),
    charging: raw.isCharging === true,
    // SI leaves acConnected undefined on some platforms; charging implies mains.
    acConnected: raw.acConnected === true || raw.isCharging === true,
    minutesRemaining: minutes !== null && minutes > 0 ? Math.round(minutes) : null,
    cycleCount: cycles !== null && cycles > 0 ? Math.round(cycles) : null,
  }
}

// SMBIOS chassis names as systeminformation spells them, grouped by what an
// operator would call the machine. Anything else ('Other', 'Docking Station',
// 'IoT Gateway', an empty string) says nothing and maps to null.
const LAPTOP_CHASSIS = /^(portable|laptop|notebook|sub notebook|hand held|tablet|convertible|detachable)$/i
const DESKTOP_CHASSIS =
  /^(desktop|low profile desktop|mini tower|tower|all in one|space-saving|lunch box|sealed-case pc|mini pc|stick pc|embedded pc)$/i
const SERVER_CHASSIS =
  /^(pizza box|main server chassis|expansion chassis|sub chassis|bus expansion chassis|peripheral chassis|raid chassis|rack mount chassis|multi-system|compactpci|advancedtca|blade|blade enclosure)$/i

/**
 * What kind of machine this is. A hypervisor's guest is a VM whatever its
 * chassis claims; otherwise the chassis decides; a battery with no chassis
 * type is still a laptop. A server that reports nothing stays null rather
 * than guessed.
 */
export function deriveHostKind(input: {
  virtual: boolean | null
  chassisType: string | null
  battery: HostBatteryInfo | null
}): HostKind | null {
  if (input.virtual === true) return 'vm'
  const chassis = (input.chassisType ?? '').trim()
  if (LAPTOP_CHASSIS.test(chassis)) return 'notebook'
  if (DESKTOP_CHASSIS.test(chassis)) return 'desktop'
  if (SERVER_CHASSIS.test(chassis)) return 'server'
  if (input.battery) return 'notebook'
  return null
}

export function normalizeLoad(...candidates: unknown[]): HostLoad | null {
  for (const candidate of candidates) {
    const samples = Array.isArray(candidate) ? candidate : null
    if (!samples) continue
    const one = asFiniteNumber(samples[0])
    const five = asFiniteNumber(samples[1])
    const fifteen = asFiniteNumber(samples[2])
    if (one !== null && five !== null && fifteen !== null) return { one, five, fifteen }
  }
  return null
}

export function normalizeHost(input: {
  system?: unknown
  os?: unknown
  cpu?: unknown
  mem?: unknown
  currentLoad?: unknown
  loadavg?: unknown
  graphics?: unknown
  time?: unknown
  cpuTemperature?: unknown
  battery?: unknown
  chassis?: unknown
  storage?: HostStorageInfo | null
}): HostMetrics {
  const system = record(input.system)
  const os = record(input.os)
  const cpu = record(input.cpu)
  const mem = record(input.mem)
  const currentLoad = record(input.currentLoad)
  const time = record(input.time)
  const chassis = record(input.chassis)

  const platform = asNonEmptyString(os?.platform)
  const virtual = asBoolean(system?.virtual)
  const battery = normalizeBattery(input.battery)
  // macOS puts the marketing name ("MacBook Pro (14-inch, M3 Pro, Nov 2023)")
  // in system.version. On Linux the same field is DMI product_version, which
  // QEMU fills with "pc-q35-8.2"; there the model (DMI product_name) already
  // names the box as well as anything will.
  const productName = platform === 'darwin' ? asNonEmptyString(system?.version) : null
  // si.chassis() is the source; si.system() repeats the type on macOS only.
  const chassisType = asNonEmptyString(chassis?.type) ?? asNonEmptyString(system?.type)

  const memoryTotalBytes = asFiniteNumber(mem?.total)
  const memoryAvailableBytes = asFiniteNumber(mem?.available) ?? asFiniteNumber(mem?.free)
  const memoryUsedBytes =
    memoryTotalBytes !== null && memoryAvailableBytes !== null
      ? Math.max(0, memoryTotalBytes - memoryAvailableBytes)
      : asFiniteNumber(mem?.used)
  const swapTotal = asFiniteNumber(mem?.swaptotal)
  const swapUsed = asFiniteNumber(mem?.swapused)

  const utilisation = percentToUnit(asFiniteNumber(currentLoad?.currentLoad))
  const idle = percentToUnit(asFiniteNumber(currentLoad?.currentLoadIdle))
  const gpus = normalizeGpus(input.graphics)

  return {
    hostname: asNonEmptyString(os?.hostname) ?? asNonEmptyString(system?.hostname),
    manufacturer: asNonEmptyString(system?.manufacturer),
    model: asNonEmptyString(system?.model),
    productName,
    kind: deriveHostKind({ virtual, chassisType, battery }),
    architecture: asNonEmptyString(os?.arch) ?? asNonEmptyString(cpu?.arch),
    virtual,
    platform,
    distro: asNonEmptyString(os?.distro),
    version: asNonEmptyString(os?.release) ?? asNonEmptyString(os?.build),
    release: asNonEmptyString(os?.codename) ?? asNonEmptyString(os?.release),
    kernel: asNonEmptyString(os?.kernel),
    uptimeSeconds: asFiniteNumber(time?.uptime),
    cpu: {
      manufacturer: asNonEmptyString(cpu?.manufacturer),
      brand: asNonEmptyString(cpu?.brand),
      physicalCores: asFiniteNumber(cpu?.physicalCores),
      logicalCores: asFiniteNumber(cpu?.cores),
      speed: asFiniteNumber(cpu?.speed),
      speedMax: asFiniteNumber(cpu?.speedMax),
    },
    memoryTotalBytes,
    memoryUsedBytes,
    memoryAvailableBytes,
    memoryUsedPercent: ratio(memoryUsedBytes, memoryTotalBytes),
    swapTotalBytes: swapTotal !== null && swapTotal > 0 ? swapTotal : null,
    swapUsedBytes: swapTotal !== null && swapTotal > 0 ? swapUsed : null,
    cpuUtilisation: utilisation,
    cpuIdle: idle,
    load: normalizeLoad(input.loadavg, input.currentLoad),
    storage: input.storage ?? null,
    gpu: gpus,
    temperatureCelsius: normalizeTemperature(input.cpuTemperature, gpus),
    battery,
  }
}

const DOCKER_SIZE = /^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)$/
const DOCKER_SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000 ** 2,
  gb: 1_000 ** 3,
  tb: 1_000 ** 4,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
}

/** Docker stats prints `1.23MiB`, `8.19kB`, `--`. */
export function parseDockerSize(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '--') return null
  const match = DOCKER_SIZE.exec(trimmed)
  if (!match) return null
  const amount = Number(match[1])
  const factor = DOCKER_SIZE_UNITS[match[2]!.toLowerCase()]
  if (!Number.isFinite(amount) || factor === undefined) return null
  return amount * factor
}

export function parseDockerPercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/%$/, '')
  if (trimmed === '' || trimmed === '--') return null
  const amount = Number(trimmed)
  return Number.isFinite(amount) ? amount : null
}

export function parseDockerPair(value: unknown): { left: number | null; right: number | null } {
  if (typeof value !== 'string') return { left: null, right: null }
  const [left, right] = value.split(/\s*\/\s*/)
  return { left: parseDockerSize(left), right: parseDockerSize(right) }
}

/** Turn `docker stats --format '{{json .}}'` into the numeric shape normalizeContainerStats already accepts. */
export function dockerCliStatsToRaw(row: Record<string, unknown>): Record<string, unknown> {
  const mem = parseDockerPair(row.MemUsage ?? row.memUsage)
  const net = parseDockerPair(row.NetIO ?? row.netIO)
  const block = parseDockerPair(row.BlockIO ?? row.blockIO)
  const pids = parseDockerPercent(row.PIDs ?? row.pids)
  return {
    cpuPercent: parseDockerPercent(row.CPUPerc ?? row.cpuPercent),
    memUsage: mem.left,
    memLimit: mem.right,
    memPercent: parseDockerPercent(row.MemPerc ?? row.memPercent),
    netIO: { rx: net.left, tx: net.right },
    blockIO: { rx: block.left, tx: block.right },
    pids: pids !== null ? Math.round(pids) : null,
  }
}

function ioPair(value: unknown): { rx: number | null; tx: number | null } {
  const object = record(value)
  if (object) {
    return {
      rx: asFiniteNumber(object.rx_bytes) ?? asFiniteNumber(object.rx) ?? asFiniteNumber(object.r),
      tx:
        asFiniteNumber(object.tx_bytes) ??
        asFiniteNumber(object.tx) ??
        asFiniteNumber(object.wx) ??
        asFiniteNumber(object.w),
    }
  }
  return { rx: null, tx: null }
}

export function normalizeContainerStats(
  stats: unknown,
  identity: { id: string; name: string; service: string | null },
): ContainerResourceMetrics {
  const raw = record(stats) ?? {}
  const memoryUsedBytes = asFiniteNumber(raw.memUsage) ?? asFiniteNumber(raw.memoryUsed)
  const memoryLimitBytes = asFiniteNumber(raw.memLimit) ?? asFiniteNumber(raw.memoryLimit)
  const memoryPercent = asFiniteNumber(raw.memPercent)
  const cpuPercent = asFiniteNumber(raw.cpuPercent) ?? asFiniteNumber(raw.cpu)
  const net = ioPair(raw.netIO)
  const block = ioPair(raw.blockIO)
  return {
    id: identity.id,
    name: identity.name,
    service: identity.service,
    cpuUtilisation: percentToUnit(cpuPercent),
    memoryUsedBytes,
    memoryLimitBytes: memoryLimitBytes !== null && memoryLimitBytes > 0 ? memoryLimitBytes : null,
    memoryUsedPercent: memoryPercent !== null ? percentToUnit(memoryPercent) : ratio(memoryUsedBytes, memoryLimitBytes),
    networkRxBytes: net.rx,
    networkTxBytes: net.tx,
    blockReadBytes: block.rx,
    blockWriteBytes: block.tx,
    pids: asFiniteNumber(raw.pids),
  }
}

export interface ContainerIdentity {
  id: string
  name: string
  labels: Record<string, string>
}

export function composeProjectOf(labels: Record<string, string>): string | null {
  return asNonEmptyString(labels['com.docker.compose.project'])
}

export function projectNameOf(labels: Record<string, string>, composeProject: string): string {
  return asNonEmptyString(labels['portta.project']) ?? composeProject
}

export function serviceOf(labels: Record<string, string>): string | null {
  return asNonEmptyString(labels['com.docker.compose.service'])
}

export function aggregateProjects(
  containers: ContainerResourceMetrics[],
  identities: ContainerIdentity[],
): ProjectResourceMetrics[] {
  const byId = new Map(identities.map((item) => [item.id, item]))
  const groups = new Map<string, ProjectResourceMetrics>()

  for (const container of containers) {
    const identity = byId.get(container.id)
    const labels = identity?.labels ?? {}
    const composeProject = composeProjectOf(labels) ?? '_standalone'
    const name = composeProject === '_standalone' ? 'Standalone' : projectNameOf(labels, composeProject)
    const existing = groups.get(composeProject) ?? {
      id: composeProject,
      name,
      composeProject,
      cpuUtilisation: 0,
      memoryUsedBytes: 0,
      containerCount: 0,
      networkRxBytes: 0,
      networkTxBytes: 0,
      containers: [],
    }
    existing.containerCount += 1
    existing.cpuUtilisation = (existing.cpuUtilisation ?? 0) + (container.cpuUtilisation ?? 0)
    existing.memoryUsedBytes = (existing.memoryUsedBytes ?? 0) + (container.memoryUsedBytes ?? 0)
    existing.networkRxBytes = (existing.networkRxBytes ?? 0) + (container.networkRxBytes ?? 0)
    existing.networkTxBytes = (existing.networkTxBytes ?? 0) + (container.networkTxBytes ?? 0)
    existing.containers.push(container)
    groups.set(composeProject, existing)
  }

  return [...groups.values()]
    .map((project) => ({
      ...project,
      cpuUtilisation: project.containerCount === 0 ? null : project.cpuUtilisation,
      memoryUsedBytes: project.containerCount === 0 ? null : project.memoryUsedBytes,
      containers: [...project.containers].sort(
        (left, right) => (right.memoryUsedBytes ?? 0) - (left.memoryUsedBytes ?? 0),
      ),
    }))
    .sort((left, right) => (right.memoryUsedBytes ?? 0) - (left.memoryUsedBytes ?? 0))
}

export function historyPointFrom(snapshot: MetricsSnapshot): MetricsHistoryPoint {
  const gpuUtil = snapshot.host.gpu.map((gpu) => gpu.utilisation).find((value) => value !== null) ?? null
  return {
    timestamp: snapshot.collectedAt,
    host: {
      cpuUtilisation: snapshot.host.cpuUtilisation,
      memoryUsedBytes: snapshot.host.memoryUsedBytes,
      memoryUsedPercent: snapshot.host.memoryUsedPercent,
      storageUsedPercent: snapshot.host.storage?.usedPercent ?? null,
      load: snapshot.host.load,
      gpuUtilisation: gpuUtil,
      temperatureCelsius: snapshot.host.temperatureCelsius,
    },
    projects: snapshot.projects.map((project) => ({
      id: project.id,
      cpuUtilisation: project.cpuUtilisation,
      memoryUsedBytes: project.memoryUsedBytes,
    })),
    containers: snapshot.projects.flatMap((project) =>
      project.containers.map((container) => ({
        id: container.id,
        cpuUtilisation: container.cpuUtilisation,
        memoryUsedBytes: container.memoryUsedBytes,
      })),
    ),
  }
}

export function mergeHistoryLines(
  existing: string,
  point: MetricsHistoryPoint,
  now: number,
  retentionSeconds = HISTORY_RETENTION_SECONDS,
): string {
  const kept: string[] = []
  for (const line of existing.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as { timestamp?: unknown }
      const timestamp = asFiniteNumber(parsed.timestamp)
      if (timestamp === null || now - timestamp > retentionSeconds) continue
      kept.push(line)
    } catch {
      // A broken line is dropped rather than poisoning the file.
    }
  }
  kept.push(JSON.stringify(point))
  return `${kept.join('\n')}\n`
}

export function parseHistoryLines(text: string, since: number): MetricsHistoryPoint[] {
  const points: MetricsHistoryPoint[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as MetricsHistoryPoint
      if (typeof parsed.timestamp === 'number' && parsed.timestamp >= since) points.push(parsed)
    } catch {
      // skip
    }
  }
  return points
}
