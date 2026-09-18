// One snapshot of the host, built from Docker at request time.
//
// Everything the panel shows (environments, services, URLs, networks, ports,
// bridges) remains a view over this. Persistence records only that a project
// was seen; a container that disappears still stops appearing in this view.

import type {
  ContainerState,
  ContainerSummary,
  Environment,
  Health,
  NetworkSummary,
  Ownership,
  PortUsage,
  PublishedPort,
  RouteUrl,
  UrlScope,
} from 'portta-contracts'
import { composeFilesFromLabel, parseRemote, projectOperable, serviceKind, slug } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { schemeFor } from '../config.ts'
import { projectStartable } from './actions.ts'
import type { DockerClient } from './docker/client.ts'
import type {
  DockerContainerInspect,
  DockerContainerListItem,
  DockerInfo,
  DockerNetwork,
  DockerVersion,
} from './docker/types.ts'
import { LABELS, relevantLabels } from './labels.ts'
import { resolveServiceTech } from './tech.ts'

export interface Snapshot {
  at: number
  reachable: boolean
  containers: ContainerSummary[]
  environments: Environment[]
  networks: NetworkSummary[]
  ports: PortUsage[]
  info: DockerInfo | null
  version: DockerVersion | null
}

const KNOWN_STATES: ContainerState[] = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']

function toState(value: string): ContainerState {
  const found = KNOWN_STATES.find((state) => state === value)
  return found ?? 'exited'
}

function toHealth(inspect: DockerContainerInspect | null): Health {
  const status = inspect?.State.Health?.Status
  if (status === 'healthy' || status === 'unhealthy' || status === 'starting') return status
  return 'none'
}

function epoch(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms) || ms <= 0) return null
  return Math.floor(ms / 1000)
}

function basename(path: string | null): string | null {
  if (!path) return null
  const parts = path.split('/').filter(Boolean)
  return parts.length ? (parts[parts.length - 1] ?? null) : null
}

/**
 * Compose does not have a first-class job kind. An exit code of zero is not
 * enough: an ordinary web service stopped cleanly also exits zero under the
 * default `restart: no`. Only conventional one-shot service names earn the
 * completed state.
 */
const COMPLETED_JOB = /(^|[-_])(migrat(?:e|or|ion|ions)|init|seed|setup|bootstrap|job)([-_]|$)/i
const WORKER_SERVICE = /(^|[-_])(worker|queue|scheduler|cron|consumer|beat|horizon|celery|sidekiq|resque)([-_]|$)/i

/** Every Host(`...`) a router rule names, in label order. */
export function hostsFromRules(labels: Record<string, string>): string[] {
  const hosts: string[] = []
  const keys = Object.keys(labels)
    .filter((key) => key.startsWith('traefik.http.routers.') && key.endsWith('.rule'))
    .sort()
  for (const key of keys) {
    const rule = labels[key] ?? ''
    for (const match of rule.matchAll(/Host\(`([^`]+)`\)/g)) {
      const host = match[1]
      if (host && !hosts.includes(host)) hosts.push(host)
    }
  }
  return hosts
}

export function scopeForHost(host: string, config: PanelConfig): UrlScope {
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) return 'local'
  if (config.publicDomain && lower.endsWith(`.${config.publicDomain.toLowerCase()}`)) return 'public'
  if (config.privateDomain && lower.endsWith(`.${config.privateDomain.toLowerCase()}`)) return 'vpn'
  switch (config.profile) {
    case 'remote-public':
      return 'public'
    case 'remote-private':
      return 'vpn'
    default:
      return 'local'
  }
}

/**
 * Mirrors portta_discover_http: an explicit Host() rule wins, otherwise Traefik's
 * default rule derives the hostname from the Compose labels.
 */
/** A container carries TCP router labels and no HTTP ones. */
export function isTcpOnly(labels: Record<string, string>): boolean {
  const keys = Object.keys(labels)
  return (
    keys.some((key) => key.startsWith('traefik.tcp.routers.')) && !keys.some((key) => key.startsWith('traefik.http.'))
  )
}

export function urlsFor(labels: Record<string, string>, containerName: string, config: PanelConfig): RouteUrl[] {
  if (labels[LABELS.traefikEnable] !== 'true') return []
  // A datastore routed by hostname opted into the gateway, but it is not
  // reached with a browser and has no URL. See docs/product/guides/tcp-routing.md.
  if (isTcpOnly(labels)) return []
  const scheme = schemeFor(config)
  let hosts = hostsFromRules(labels)
  if (hosts.length === 0) {
    const project = labels[LABELS.composeProject]
    const service = labels[LABELS.composeService]
    const label = project ? `${slug(project)}-${slug(service ?? '')}` : slug(containerName)
    hosts = [`${label}.${config.domain}`]
  }
  return hosts.map((host) => ({
    host,
    url: `${scheme}://${host}`,
    scheme,
    scope: scopeForHost(host, config),
  }))
}

function publishedPorts(inspect: DockerContainerInspect | null, item: DockerContainerListItem): PublishedPort[] {
  const out: PublishedPort[] = []
  const bindings = inspect?.NetworkSettings.Ports
  if (bindings) {
    for (const [spec, list] of Object.entries(bindings)) {
      if (!list) continue
      const [portPart, protocol] = spec.split('/')
      const containerPort = Number(portPart)
      for (const binding of list) {
        const hostPort = Number(binding.HostPort ?? '0')
        if (!hostPort) continue
        out.push({
          ip: binding.HostIp || '0.0.0.0',
          hostPort,
          containerPort,
          protocol: protocol ?? 'tcp',
        })
      }
    }
    return out.sort((a, b) => a.hostPort - b.hostPort)
  }
  for (const port of item.Ports ?? []) {
    if (!port.PublicPort) continue
    out.push({
      ip: port.IP || '0.0.0.0',
      hostPort: port.PublicPort,
      containerPort: port.PrivatePort,
      protocol: port.Type ?? 'tcp',
    })
  }
  return out.sort((a, b) => a.hostPort - b.hostPort)
}

function exposedPorts(inspect: DockerContainerInspect | null): number[] {
  const specs = Object.keys(inspect?.Config.ExposedPorts ?? {})
  return specs
    .filter((spec) => spec.endsWith('/tcp'))
    .map((spec) => Number(spec.split('/')[0]))
    .filter((port) => Number.isFinite(port) && port > 0)
    .sort((a, b) => a - b)
}

function classify(labels: Record<string, string>, onGatewayNetwork: boolean, project: string | null): Ownership {
  if (labels[LABELS.managed] === 'true') return 'gateway'
  if (project === null) return 'standalone'
  if (onGatewayNetwork || labels[LABELS.traefikEnable] === 'true') return 'integrated'
  return 'external'
}

export function summarise(
  item: DockerContainerListItem,
  inspect: DockerContainerInspect | null,
  config: PanelConfig,
  now: number,
): ContainerSummary {
  const labels = inspect?.Config.Labels ?? item.Labels ?? {}
  const name = (inspect?.Name ?? item.Names[0] ?? '').replace(/^\//, '')
  const networks = Object.keys(inspect?.NetworkSettings.Networks ?? item.NetworkSettings?.Networks ?? {}).sort()
  const onGatewayNetwork = networks.includes(config.network)
  const project = labels[LABELS.composeProject] ?? null
  const service = labels[LABELS.composeService] ?? null
  const workingDir = labels[LABELS.composeWorkingDir] ?? null
  // Declared identity, when a project bothered to declare it. Never required:
  // `namespace` below is the same inference the panel has always made.
  const declaredProject = labels[LABELS.project] ?? null
  const declaredRepo = labels[LABELS.repo] ?? null
  const gitRoot = labels[LABELS.gitRoot] ?? null
  const image = inspect?.Config.Image ?? item.Image
  const startedAt = epoch(inspect?.State.StartedAt)
  const state = toState(inspect?.State.Status ?? item.State)
  const dirName = basename(workingDir)

  // `docker compose run` gives the container the service's labels and one more.
  // It belongs to the environment, but it is not the service: no URL, so the
  // panel never routes it or sees it collide with the real one.
  const oneOff = (labels[LABELS.composeOneoff] ?? '').toLowerCase() === 'true'
  const urls = oneOff ? [] : urlsFor(labels, name, config)
  const ports = publishedPorts(inspect, item)
  const exposed = exposedPorts(inspect)
  const exitCode = inspect ? inspect.State.ExitCode : null
  const restartPolicy = inspect?.HostConfig?.RestartPolicy?.Name ?? ''
  // A migration that ran and exited 0 under `restart: no` did its job. Docker
  // calls it exited; the environment is not degraded because of it.
  const completed =
    state === 'exited' &&
    exitCode === 0 &&
    (restartPolicy === '' || restartPolicy === 'no') &&
    COMPLETED_JOB.test(service ?? '')

  return {
    id: item.Id,
    name,
    image,
    state,
    status: item.Status,
    health: toHealth(inspect),
    createdAt: item.Created,
    startedAt,
    uptimeSeconds: state === 'running' && startedAt ? Math.max(0, now - startedAt) : null,
    ownership: classify(labels, onGatewayNetwork, project),
    gatewayComponent: labels[LABELS.component] ?? null,
    environment: project,
    service,
    workingDir,
    namespace: dirName && project && dirName !== project ? dirName : null,
    group: declaredProject,
    repo: declaredRepo,
    repoUrl: declaredRepo ? (parseRemote(declaredRepo)?.repoUrl ?? null) : null,
    gitRoot,
    networks,
    onGatewayNetwork,
    traefikEnabled: labels[LABELS.traefikEnable] === 'true',
    ports,
    exposedPorts: exposed,
    // Opting a database into hostname routing also sets traefik.enable, so
    // asking that label alone would call PostgreSQL an HTTP service. What
    // makes something HTTP is ending up with a URL. A worker image can inherit
    // EXPOSE from the web runtime it shares, so a conventional worker/job name
    // is stronger evidence than that image metadata. A container with no port
    // at all is likewise a worker, not "TCP".
    kind:
      urls.length > 0
        ? 'http'
        : completed || WORKER_SERVICE.test(service ?? '') || (exposed.length === 0 && ports.length === 0)
          ? 'worker'
          : serviceKind(image),
    tech: resolveServiceTech({ image, service, labels }),
    urls,
    mounts: (inspect?.Mounts ?? item.Mounts ?? []).map((mount) => ({
      type: mount.Type,
      name: mount.Name ?? null,
      source: mount.Source,
      destination: mount.Destination,
      rw: mount.RW,
    })),
    labels: relevantLabels(labels),
    restartCount: inspect?.RestartCount ?? 0,
    exitCode,
    oneOff,
    completed,
  }
}

/**
 * A project is integrated when at least one of its services opted into the
 * gateway. Its other services (a database, a cache) belong to it too, even
 * though they never touch the shared network.
 */
export function groupEnvironments(containers: ContainerSummary[], now: number): Environment[] {
  const byEnvironment = new Map<string, ContainerSummary[]>()
  for (const container of containers) {
    if (container.ownership === 'gateway' || container.environment === null) continue
    // A `compose run` container stays in the snapshot (the Docker page lists
    // it) but is not a service of the environment: not a row, not a count,
    // not a URL. Its state is its own business.
    if (container.oneOff) continue
    const list = byEnvironment.get(container.environment)
    if (list) list.push(container)
    else byEnvironment.set(container.environment, [container])
  }

  const environments: Environment[] = []
  for (const [name, services] of byEnvironment) {
    const integrated = services.some((service) => service.ownership === 'integrated')
    if (integrated) {
      for (const service of services) {
        if (service.ownership === 'external') service.ownership = 'integrated'
      }
    }
    services.sort((a, b) => (a.service ?? '').localeCompare(b.service ?? ''))
    const urls = services.flatMap((service) => service.urls)
    const started = services.map((service) => service.startedAt).filter((value): value is number => value !== null)
    const startedAt = started.length ? Math.min(...started) : null
    const withDir = services.find((service) => service.workingDir)
    const configFiles = composeFilesFromLabel(
      services.find((service) => service.labels[LABELS.composeConfigFiles])?.labels[LABELS.composeConfigFiles],
    )
    const declared = services.find((service) => service.group)
    const withRepo = services.find((service) => service.repo)
    environments.push({
      name,
      presence: 'live',
      integrated,
      workingDir: withDir?.workingDir ?? null,
      operable: projectOperable(withDir?.workingDir ?? null, configFiles),
      startable: projectStartable(services),
      namespace: services.find((service) => service.namespace)?.namespace ?? null,
      // A project declares these once, on any of its services. The first that
      // does wins, and none of them doing so is the normal case.
      group: declared?.group ?? null,
      repo: withRepo?.repo ?? null,
      repoUrl: withRepo?.repoUrl ?? null,
      gitRoot: services.find((service) => service.gitRoot)?.gitRoot ?? null,
      services,
      serviceCount: services.length,
      runningCount: services.filter((service) => service.state === 'running').length,
      completedCount: services.filter((service) => service.completed).length,
      healthyCount: services.filter((service) => service.health === 'healthy').length,
      unhealthyCount: services.filter((service) => service.health === 'unhealthy').length,
      networks: [...new Set(services.flatMap((service) => service.networks))].sort(),
      urls,
      scopes: [...new Set(urls.map((url) => url.scope))],
      startedAt,
      uptimeSeconds: startedAt ? Math.max(0, now - startedAt) : null,
    })
  }
  environments.sort((a, b) => a.name.localeCompare(b.name))
  return environments
}

function networkRole(name: string, config: PanelConfig): NetworkSummary['role'] {
  if (name === config.network) return 'shared'
  if (name === config.controlNetwork || name === config.webNetwork) return 'control'
  if (name === config.accessNetwork) return 'access'
  if (['bridge', 'host', 'none'].includes(name)) return 'other'
  return 'project'
}

/**
 * Docker's network *list* endpoint omits the attached containers (only a
 * single-network inspect carries them), so the count is taken from the
 * containers we already have. Same answer, one fewer round trip per network.
 */
export function summariseNetworks(
  networks: DockerNetwork[],
  config: PanelConfig,
  containers: ContainerSummary[] = [],
): NetworkSummary[] {
  const attached = new Map<string, number>()
  for (const container of containers) {
    if (container.state !== 'running') continue
    for (const name of container.networks) {
      attached.set(name, (attached.get(name) ?? 0) + 1)
    }
  }

  return networks
    .map((network) => ({
      id: network.Id,
      name: network.Name,
      driver: network.Driver,
      scope: network.Scope,
      internal: network.Internal,
      containerCount: Object.keys(network.Containers ?? {}).length || (attached.get(network.Name) ?? 0),
      managed: network.Labels?.[LABELS.managed] === 'true',
      role: networkRole(network.Name, config),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function collectPorts(containers: ContainerSummary[]): PortUsage[] {
  const byPort = new Map<string, PortUsage>()
  for (const container of containers) {
    if (container.state !== 'running') continue
    for (const port of container.ports) {
      const key = `${port.hostPort}/${port.protocol}`
      let usage = byPort.get(key)
      if (!usage) {
        usage = { hostPort: port.hostPort, protocol: port.protocol, bindings: [], conflict: false }
        byPort.set(key, usage)
      }
      usage.bindings.push({
        ip: port.ip,
        containerId: container.id,
        containerName: container.name,
        ownership: container.ownership,
        containerPort: port.containerPort,
      })
    }
  }
  for (const usage of byPort.values()) {
    const distinct = new Set(usage.bindings.map((binding) => binding.containerId))
    usage.conflict = distinct.size > 1
  }
  return [...byPort.values()].sort((a, b) => a.hostPort - b.hostPort)
}

async function inspectAll(
  client: DockerClient,
  items: DockerContainerListItem[],
): Promise<Map<string, DockerContainerInspect | null>> {
  const results = new Map<string, DockerContainerInspect | null>()
  const CONCURRENCY = 8
  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      const item = items[index]
      if (!item) return
      try {
        results.set(item.Id, await client.inspect(item.Id))
      } catch {
        // The container went away between listing and inspecting. The list
        // entry still carries enough to render a row.
        results.set(item.Id, null)
      }
    }
  })
  await Promise.all(workers)
  return results
}

export async function buildSnapshot(client: DockerClient, config: PanelConfig): Promise<Snapshot> {
  const now = Math.floor(Date.now() / 1000)
  let items: DockerContainerListItem[] = []
  let networks: DockerNetwork[] = []
  let info: DockerInfo | null = null
  let version: DockerVersion | null = null
  let reachable = true

  try {
    ;[items, networks, info, version] = await Promise.all([
      client.listContainers(true),
      client.listNetworks().catch(() => [] as DockerNetwork[]),
      client.info().catch(() => null),
      client.version().catch(() => null),
    ])
  } catch {
    reachable = false
  }

  const inspects = await inspectAll(client, items)
  const containers = items
    .map((item) => summarise(item, inspects.get(item.Id) ?? null, config, now))
    .sort((a, b) => a.name.localeCompare(b.name))

  const environments = groupEnvironments(containers, now)

  return {
    at: now,
    reachable,
    containers,
    environments,
    networks: summariseNetworks(networks, config, containers),
    ports: collectPorts(containers),
    info,
    version,
  }
}

/**
 * A very short cache. Several endpoints and every SSE-driven refetch land at
 * once; rebuilding the snapshot for each of them would hammer the proxy for no
 * new information.
 */
export function createSnapshotCache(
  client: DockerClient,
  config: PanelConfig,
  ttlMs = 1000,
  onSnapshot?: (snapshot: Snapshot) => void | Promise<void>,
) {
  let pending: Promise<Snapshot> | null = null
  let cached: { at: number; snapshot: Snapshot } | null = null

  return {
    async get(force = false): Promise<Snapshot> {
      const now = Date.now()
      if (!force && cached && now - cached.at < ttlMs) return cached.snapshot
      if (!force && pending) return pending
      pending = buildSnapshot(client, config)
        .then((snapshot) => {
          cached = { at: Date.now(), snapshot }
          // Persistence is deliberately off the request path. A slow or dead
          // database never delays the Docker view that has always powered the
          // panel; its observer owns and reports its own failure.
          if (onSnapshot) void Promise.resolve(onSnapshot(snapshot)).catch(() => undefined)
          return snapshot
        })
        .finally(() => {
          pending = null
        })
      return pending
    },
    invalidate(): void {
      cached = null
    },
  }
}

export type SnapshotCache = ReturnType<typeof createSnapshotCache>
