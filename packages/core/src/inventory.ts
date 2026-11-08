import type { StoredAlias } from './aliases.ts'
import { hostLabelFromLabels, hostnameFromLabel } from './hostname.ts'
import { httpRoutes, isTcpOnly, traefikEnabled } from './traefik-rules.ts'

export interface ContainerRecord {
  id: string
  name: string
  image: string
  state: string
  labels: Record<string, string>
  ports: Array<{ ip: string; privatePort: number; publicPort: number | null; type: string }>
  networks: string[]
  /**
   * The fields below are only populated by the CLI's own inspector, which
   * reads them from `docker inspect`. The panel reaches Docker through a
   * filtered proxy and does not always have them, so every consumer must treat
   * them as optional rather than as a promise.
   */
  health?: string | null
  /** `container:<id>` when this container shares another's network namespace. */
  networkMode?: string
  mounts?: Array<{ source: string; readWrite: boolean }>
}

export interface RouteRecord {
  project: string | null
  service: string | null
  container: string
  hostname: string
  url: string
  port: string
  state: string
  /** Added in the panel beside the hostname the project derives. */
  alias?: boolean
  /** A domain the user pointed at the gateway. */
  custom?: boolean
  /** The address to report for this service: its custom domain if it has one, else the derived one. */
  primary?: boolean
}

/** Panel-created hostnames as routes, so every command lists what the gateway actually answers on. */
export function aliasRoutes(aliases: StoredAlias[], containers: ContainerRecord[] = []): RouteRecord[] {
  const state = new Map(containers.map((container) => [container.name, container.state]))
  return aliases.map((alias) => ({
    project: alias.project,
    service: alias.service,
    container: alias.container,
    hostname: alias.host,
    url: `${alias.entryPoint === 'websecure' ? 'https' : 'http'}://${alias.host}`,
    port: String(alias.port),
    state: state.get(alias.container) ?? 'alias',
    alias: true,
    ...(alias.custom ? { custom: true } : {}),
  }))
}

/**
 * Marks the one address to report per service.
 *
 * A domain the user chose wins, because it is the one they will open and share; otherwise the
 * address the project derives; otherwise a nickname added in the panel.
 */
export function markPrimary(routes: RouteRecord[]): RouteRecord[] {
  const rank = (route: RouteRecord): number => (route.custom ? 0 : route.alias ? 2 : 1)
  const best = new Map<string, RouteRecord>()
  for (const route of routes) {
    const key = `${route.project ?? ''}\u0000${route.service ?? route.container}`
    const current = best.get(key)
    if (!current || rank(route) < rank(current)) best.set(key, route)
  }
  return routes.map((route) => ({
    ...route,
    primary: best.get(`${route.project ?? ''}\u0000${route.service ?? route.container}`) === route,
  }))
}

/** A bad container label must not hide every other service in the inventory. */
export function routeHostnameProblem(
  container: Pick<ContainerRecord, 'name' | 'labels'>,
  domain: string,
): string | null {
  if (!traefikEnabled(container.labels) || isTcpOnly(container.labels) || !httpRoutes(container.labels).usesDefaultRule)
    return null
  try {
    hostnameFromLabel(hostLabelFromLabels(container.labels, container.name), domain)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function routesFor(
  containers: ContainerRecord[],
  domain: string,
  scheme: 'http' | 'https' = 'http',
): RouteRecord[] {
  return containers
    .flatMap((container) => {
      if (!traefikEnabled(container.labels) || isTcpOnly(container.labels)) return []
      const labelEntries = Object.entries(container.labels)
      const project = container.labels['com.docker.compose.project'] || null
      const service = container.labels['com.docker.compose.service'] || null
      const routes = httpRoutes(container.labels)
      const explicit = routes.hosts[0]
      // An explicit rule that names no host has no hostname to list, and the
      // derived one would be fiction: nothing answers there. The panel's public
      // entrypoint is exactly this shape (PathPrefix on its own entrypoint).
      if (!routes.usesDefaultRule && !explicit) return []
      if (!explicit && routeHostnameProblem(container, domain)) return []
      const hostname = explicit || hostnameFromLabel(hostLabelFromLabels(container.labels, container.name), domain)
      const port =
        labelEntries.find(([key]) => /^traefik\.http\.services\..*\.loadbalancer\.server\.port$/.test(key))?.[1] ||
        'auto'
      return [
        {
          project,
          service,
          container: container.name,
          hostname,
          url: `${scheme}://${hostname}`,
          port,
          state: container.state,
        },
      ]
    })
    .sort((a, b) => a.hostname.localeCompare(b.hostname))
}

export interface ProjectRecord {
  name: string
  state: string
  services: ContainerRecord[]
  urls: RouteRecord[]
}

export function projectsFor(
  containers: ContainerRecord[],
  domain: string,
  scheme: 'http' | 'https' = 'http',
  aliases: StoredAlias[] = [],
): ProjectRecord[] {
  const routes = markPrimary([...routesFor(containers, domain, scheme), ...aliasRoutes(aliases, containers)])
  const grouped = new Map<string, ContainerRecord[]>()
  for (const container of containers) {
    const project = container.labels['com.docker.compose.project']
    if (!project) continue
    const list = grouped.get(project) ?? []
    list.push(container)
    grouped.set(project, list)
  }
  return [...grouped.entries()]
    .map(([name, services]) => ({
      name,
      state: services.some((service) => service.state === 'running') ? 'running' : 'stopped',
      services: services.sort((a, b) =>
        (a.labels['com.docker.compose.service'] || a.name).localeCompare(
          b.labels['com.docker.compose.service'] || b.name,
        ),
      ),
      urls: routes.filter((route) => route.project === name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
