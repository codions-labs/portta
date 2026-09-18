// What the gateway decided about a project, kept in the gateway's own database.
//
// A project joins by adding one overlay file and changing nothing else, so
// everything the panel knows about it is whatever the project happened to
// declare. Overrides close that gap from the gateway's side: a friendly name,
// an ordering, a hidden service, a note — and one hostname alias that genuinely
// resolves, because a displayed address that answers nothing is worse than no
// feature at all.
//
// Nothing here writes a byte inside a project. See ADR 0001 and ADR 0011.

import type { ContainerSummary, Environment, EnvironmentOverrides, ServiceOverrides } from 'portta-contracts'
import { parseAliases, renderAliases, type StoredAlias } from 'portta-core'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import { ENVIRONMENT_KEYS, SERVICE_KEYS } from '../db/keys.ts'
import { GENERATED_FILES, readGenerated, writeGenerated } from './dynamic.ts'
import type { Snapshot } from './inventory.ts'
import { hostsFromRules, isTcpOnly } from './inventory.ts'
import { LABELS } from './labels.ts'

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

export class OverrideRefused extends Error {
  status = 400
  hint: string
  constructor(message: string, hint = '') {
    super(message)
    this.name = 'OverrideRefused'
    this.hint = hint
  }
}

export interface OverrideMap {
  environments: Map<string, EnvironmentOverrides>
  services: Map<string, Map<string, ServiceOverrides>>
}

export const EMPTY_OVERRIDES: OverrideMap = { environments: new Map(), services: new Map() }

/**
 * Reads every override in two queries.
 *
 * A per-project fan-out would run on every Docker event, so this stays two
 * round trips whatever the host is running.
 */
export async function loadOverrides(db: Database | null): Promise<OverrideMap> {
  if (db === null || !db.status().available) return EMPTY_OVERRIDES

  const [projectRows, serviceRows] = await Promise.all([db.settings.listAllEnvironment(), db.settings.listAllService()])

  const environments = new Map<string, EnvironmentOverrides>()
  for (const row of projectRows) {
    const schema = ENVIRONMENT_KEYS[row.key as keyof typeof ENVIRONMENT_KEYS]
    if (schema === undefined) continue
    const parsed = schema.safeParse(row.value)
    if (!parsed.success) continue
    const current = environments.get(row.composeProject) ?? {}
    environments.set(row.composeProject, { ...current, [row.key]: parsed.data })
  }

  const services = new Map<string, Map<string, ServiceOverrides>>()
  for (const row of serviceRows) {
    const schema = SERVICE_KEYS[row.key as keyof typeof SERVICE_KEYS]
    if (schema === undefined) continue
    const parsed = schema.safeParse(row.value)
    if (!parsed.success) continue
    const perProject = services.get(row.composeProject) ?? new Map<string, ServiceOverrides>()
    const current = perProject.get(row.service) ?? {}
    perProject.set(row.service, { ...current, [row.key]: parsed.data })
    services.set(row.composeProject, perProject)
  }

  return { environments, services }
}

/**
 * Decorates a snapshot without mutating anything derived.
 *
 * The derived name and hostname stay exactly where they were, and the override
 * sits beside them, so nobody ever debugs a hostname the panel quietly renamed.
 * With no overrides the objects come back untouched, which is what keeps a
 * panel with no database byte-identical to today's.
 */
export function applyOverrides<T extends Environment>(projects: T[], overrides: OverrideMap): T[] {
  if (overrides.environments.size === 0 && overrides.services.size === 0) return projects

  return projects.map((project) => {
    const projectOverrides = overrides.environments.get(project.name)
    const perService = overrides.services.get(project.name)
    if (projectOverrides === undefined && perService === undefined) return project

    const services = perService
      ? project.services.map((service) => decorateService(service, perService))
      : project.services

    return {
      ...project,
      services: orderServices(services, projectOverrides),
      ...(projectOverrides ? { overrides: projectOverrides } : {}),
    }
  })
}

function decorateService(service: ContainerSummary, perService: Map<string, ServiceOverrides>): ContainerSummary {
  const found = perService.get(service.service ?? service.name)
  return found === undefined ? service : { ...service, overrides: found }
}

/** An explicit order wins; anything unnamed keeps its derived position after it. */
function orderServices(services: ContainerSummary[], overrides: EnvironmentOverrides | undefined): ContainerSummary[] {
  const order = overrides?.serviceOrder
  if (!order || order.length === 0) return services

  const rank = new Map(order.map((name, index) => [name, index]))
  return [...services].sort((left, right) => {
    const leftRank = rank.get(left.service ?? left.name) ?? Number.MAX_SAFE_INTEGER
    const rightRank = rank.get(right.service ?? right.name) ?? Number.MAX_SAFE_INTEGER
    return leftRank - rightRank
  })
}

// ---------------------------------------------------------------------------
// The alias, and what it is refused for
// ---------------------------------------------------------------------------

/** Domains the gateway actually serves. It will not mint a hostname outside them. */
export function servedDomains(config: PanelConfig): string[] {
  return [config.domain, config.privateDomain, config.publicDomain].filter(
    (domain): domain is string => typeof domain === 'string' && domain !== '',
  )
}

/** A bare label is expanded with the default domain; anything else is taken as given. */
export function expandAlias(alias: string, config: PanelConfig): string {
  const value = alias.trim().toLowerCase().replace(/\.$/, '')
  return value.includes('.') ? value : `${value}.${config.domain}`
}

/** Every hostname any container in the snapshot already derives or declares. */
export function derivedHosts(snapshot: Snapshot): Set<string> {
  const hosts = new Set<string>()
  for (const container of snapshot.containers) {
    for (const url of container.urls) hosts.add(url.host.toLowerCase())
    for (const host of hostsFromRules(container.labels)) hosts.add(host.toLowerCase())
  }
  return hosts
}

/**
 * The HTTP port to send an alias at.
 *
 * The project's own Traefik label is the answer when it has one; a single
 * exposed port is the answer when it does not. Anything else is refused with
 * the reason rather than guessed, because a guessed port produces a router that
 * silently 502s.
 */
export function aliasPort(service: ContainerSummary): number {
  const label = Object.entries(service.labels).find(
    ([key]) => key.startsWith('traefik.http.services.') && key.endsWith('.loadbalancer.server.port'),
  )
  if (label) {
    const port = Number(label[1])
    if (Number.isFinite(port) && port > 0) return port
  }
  if (service.exposedPorts.length === 1) return service.exposedPorts[0]!
  if (service.exposedPorts.length === 0) {
    throw new OverrideRefused(
      `${service.service ?? service.name} exposes no port, so an alias has nowhere to send traffic`,
      'add a traefik.http.services.<name>.loadbalancer.server.port label to the project, or expose one port',
    )
  }
  throw new OverrideRefused(
    `${service.service ?? service.name} exposes ${service.exposedPorts.join(', ')}, so the alias target is ambiguous`,
    'add a traefik.http.services.<name>.loadbalancer.server.port label to the project',
  )
}

export function entryPointFor(config: PanelConfig): string {
  return config.tlsEnabled || config.profile !== 'local' ? 'websecure' : 'web'
}

export interface AliasRequest {
  project: string
  service: string
  alias: string
}

/**
 * Everything that must be true before a single byte is written.
 *
 * The style is `service publish`'s: the answer is a refusal naming the reason,
 * not a warning after Traefik silently dropped a router.
 */
export function planAlias(
  request: AliasRequest,
  snapshot: Snapshot,
  existing: StoredAlias[],
  config: PanelConfig,
): StoredAlias {
  const project = snapshot.environments.find((item) => item.name === request.project)
  if (!project) throw new OverrideRefused(`no project '${request.project}' is running`)

  const service = project.services.find((item) => (item.service ?? item.name) === request.service)
  if (!service) {
    throw new OverrideRefused(`project '${request.project}' has no service '${request.service}'`)
  }

  const host = expandAlias(request.alias, config)

  // Shape first: anything `quoteDynamicValue()` would refuse, or that is not a hostname at
  // all, is a refusal with a reason rather than a schema error deeper down.
  if (!HOSTNAME.test(host)) {
    throw new OverrideRefused(
      `${request.alias} is not a hostname`,
      'use lowercase letters, digits and dashes, for example shop.localhost',
    )
  }

  const domains = servedDomains(config)
  if (!domains.some((domain) => host === domain || host.endsWith(`.${domain.toLowerCase()}`))) {
    throw new OverrideRefused(
      `${host} is outside the domains this gateway serves`,
      `use a hostname under ${domains.join(', ')}`,
    )
  }

  if (derivedHosts(snapshot).has(host)) {
    throw new OverrideRefused(
      `${host} is already the hostname of a running container`,
      'an alias is an additional hostname; it never replaces one',
    )
  }

  const clash = existing.find(
    (alias) => alias.host === host && !(alias.project === request.project && alias.service === request.service),
  )
  if (clash) {
    throw new OverrideRefused(`${host} is already an alias of ${clash.project}/${clash.service}`)
  }

  // A datastore is reached through the mechanisms in docs/product/guides/tcp-routing.md, not
  // by an HTTP router that would answer with a protocol it does not speak.
  if (service.kind !== 'http' || isTcpOnly(service.labels)) {
    throw new OverrideRefused(
      `${request.service} is a ${service.kind} service, and an alias is an HTTP router`,
      'reach a database or cache through the Access page; see docs/product/guides/tcp-routing.md',
    )
  }

  if (!service.onGatewayNetwork) {
    throw new OverrideRefused(
      `${request.service} is not on the ${config.network} network, so Traefik cannot reach it`,
      'add the gateway network to this service in its overlay file',
    )
  }

  if (service.labels[LABELS.traefikEnable] !== 'true') {
    throw new OverrideRefused(`${request.service} has not enabled Traefik, so the gateway does not route it`)
  }

  return {
    project: request.project,
    service: request.service,
    // The container name, never the Compose alias: two projects can both have `web`.
    container: service.name,
    host,
    port: aliasPort(service),
    entryPoint: entryPointFor(config),
  }
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

export function loadAliases(config: PanelConfig): StoredAlias[] {
  return parseAliases(readGenerated(config.dynamicDir, GENERATED_FILES.aliases))
}

export function saveAliases(config: PanelConfig, aliases: StoredAlias[]): void {
  writeGenerated(config.dynamicDir, GENERATED_FILES.aliases, renderAliases(aliases))
}

/** Sorted so a rewrite of unchanged state produces an unchanged file. */
export function sortAliases(aliases: StoredAlias[]): StoredAlias[] {
  return [...aliases].sort(
    (left, right) => left.project.localeCompare(right.project) || left.service.localeCompare(right.service),
  )
}

export type { StoredAlias }
