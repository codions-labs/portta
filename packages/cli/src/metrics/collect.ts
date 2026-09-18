import { loadavg } from 'node:os'
import {
  aggregateProjects,
  type ContainerIdentity,
  detectRuntime,
  dockerCliStatsToRaw,
  emptySnapshot,
  filesystemForPath,
  type MetricsSnapshot,
  normalizeContainerStats,
  normalizeHost,
  serviceOf,
} from 'portta-core'
import { dockerOperatingSystem, inspectContainers, readContainerStats } from '../docker.js'
import { loadInstance } from './store.js'

type Settled<T> = PromiseSettledResult<T>

function value<T>(result: Settled<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined
}

// `systeminformation` stays out of the bundle: it is a barrel over the probes
// of every operating system, 709 KB of them for the eleven calls below. Like
// the other external packages it loads on demand, so a command that never reads
// metrics never needs it on disk.
let probes: typeof import('systeminformation') | null = null
async function systeminformation() {
  probes ??= await import('systeminformation')
  return probes
}

let staticCache: {
  system: unknown
  chassis: unknown
  os: unknown
  cpu: unknown
  graphics: unknown
} | null = null

export async function loadStaticFacts(): Promise<typeof staticCache> {
  if (staticCache) return staticCache
  const si = await systeminformation()
  const [system, chassis, os, cpu, graphics] = await Promise.allSettled([
    si.system(),
    // The chassis type is what says notebook, desktop or rack; read once.
    si.chassis(),
    si.osInfo(),
    si.cpu(),
    si.graphics(),
  ])
  staticCache = {
    system: value(system) ?? {},
    chassis: value(chassis) ?? {},
    os: value(os) ?? {},
    cpu: value(cpu) ?? {},
    graphics: value(graphics) ?? {},
  }
  return staticCache
}

function matchIdentity(row: { id: string; name: string }, identities: ContainerIdentity[]): ContainerIdentity {
  const byId = identities.find(
    (item) =>
      item.id === row.id ||
      (row.id !== '' && item.id.startsWith(row.id)) ||
      (row.id !== '' && row.id.startsWith(item.id.slice(0, 12))),
  )
  if (byId) return byId
  const byName = identities.find((item) => item.name === row.name)
  if (byName) return byName
  return { id: row.id || row.name, name: row.name || row.id.slice(0, 12), labels: {} }
}

async function collectProjects(): Promise<MetricsSnapshot['projects']> {
  const [inspected, stats] = await Promise.all([inspectContainers(false), readContainerStats()])
  if (inspected.length === 0 && stats.length === 0) return []

  const identities: ContainerIdentity[] = inspected.map((container) => ({
    id: container.id,
    name: container.name,
    labels: container.labels,
  }))

  const metrics = stats.map((row) => {
    const identity = matchIdentity(row, identities)
    return normalizeContainerStats(dockerCliStatsToRaw(row.raw), {
      id: identity.id,
      name: identity.name,
      service: serviceOf(identity.labels),
    })
  })
  return aggregateProjects(metrics, identities)
}

export async function collectSnapshot(root: string, now = Date.now()): Promise<MetricsSnapshot> {
  const collectedAt = Math.floor(now / 1000)
  const facts = await loadStaticFacts()
  const si = await systeminformation()
  const [mem, currentLoad, fsSize, operatingSystem, time, cpuTemperature, battery] = await Promise.allSettled([
    si.mem(),
    si.currentLoad(),
    si.fsSize(),
    dockerOperatingSystem(),
    Promise.resolve(si.time()),
    // Both are cheap and both are absent on most servers, where they settle
    // to a rejected promise or an empty reading and contribute nothing.
    si.cpuTemperature(),
    si.battery(),
  ])

  const os = (facts?.os ?? {}) as { hostname?: string }
  const instance = loadInstance(root, typeof os.hostname === 'string' ? os.hostname : null)
  const snapshot = emptySnapshot(instance, collectedAt)

  const mounts = value(fsSize) ?? []
  snapshot.host = normalizeHost({
    system: facts?.system,
    os: facts?.os,
    cpu: facts?.cpu,
    mem: value(mem),
    currentLoad: value(currentLoad),
    loadavg: loadavg(),
    graphics: facts?.graphics,
    time: value(time),
    cpuTemperature: value(cpuTemperature),
    battery: value(battery),
    chassis: facts?.chassis,
    storage: filesystemForPath(root, mounts),
  })

  const runtimeName = value(operatingSystem) ?? null
  snapshot.runtime = { name: detectRuntime(runtimeName) }

  try {
    snapshot.projects = await collectProjects()
  } catch {
    snapshot.projects = []
  }

  return snapshot
}
