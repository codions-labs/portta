// Traefik's own verdict on a route.
//
// The panel already reconstructs routing from labels, faithfully, and that is
// the blind spot: it reports what Traefik *should* do and never asks what it
// *did*. When the labels look right and a hostname still 404s, the answer is
// here and nowhere else.
//
// Read-only, on its own cache and its own timeout, and never inside
// createSnapshotCache: a slow or dead Traefik API must not delay a page. It
// exists only when the dashboard is enabled, which is off by default, so the
// absence is a state the UI has to render rather than a failure.
//
// See docs/development/adr/0011-bounded-traefik-write-surface.md.

import type { ContainerSummary, TraefikRouter, TraefikVerdict } from 'portta-contracts'
import type { PanelConfig } from '../config.ts'

interface RawRouter {
  name?: string
  rule?: string
  entryPoints?: string[]
  middlewares?: string[]
  service?: string
  status?: string
  provider?: string
  error?: string[] | string
  priority?: number
}

interface RawService {
  name?: string
  status?: string
  loadBalancer?: { servers?: { url?: string; address?: string }[] }
  serverStatus?: Record<string, string>
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

/** Every Host(`...`) a rule names, lowercased for comparison. */
export function hostsInRule(rule: string): string[] {
  const hosts: string[] = []
  for (const match of rule.matchAll(/Host\(`([^`]+)`\)/g)) {
    const host = match[1]?.toLowerCase()
    if (host && !hosts.includes(host)) hosts.push(host)
  }
  return hosts
}

function toRouter(raw: RawRouter, servers: Map<string, string[]>): TraefikRouter {
  const name = raw.name ?? ''
  const service = raw.service ?? ''
  // Traefik qualifies names with @provider; a router's service reference is
  // unqualified when both live in the same provider.
  const provider = raw.provider ?? name.split('@')[1] ?? ''
  const serviceKey = service.includes('@') ? service : `${service}@${provider}`

  return {
    name,
    rule: raw.rule ?? '',
    hosts: hostsInRule(raw.rule ?? ''),
    entryPoints: asArray(raw.entryPoints),
    middlewares: asArray(raw.middlewares),
    service,
    provider,
    status: raw.status ?? 'unknown',
    errors: asArray(raw.error),
    servers: servers.get(serviceKey) ?? [],
  }
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

/** The dashboard link a browser on the host can follow, when it is enabled. */
export function dashboardRouterUrl(config: PanelConfig, router: string): string | null {
  if (!config.dashboardEnabled || router === '') return null
  return `http://${config.dashboardBindAddress}:${config.dashboardPort}/dashboard/#/http/routers/${encodeURIComponent(router)}`
}

export async function fetchVerdict(config: PanelConfig, now = Date.now()): Promise<TraefikVerdict> {
  const base = { baseUrl: config.traefikApi, fetchedAt: Math.floor(now / 1000), routers: [] }

  if (!config.dashboardEnabled) {
    return {
      ...base,
      available: false,
      // Not "no problem": not asked. The UI says so rather than implying the
      // labels were confirmed by Traefik.
      reason: 'the Traefik API is off (PORTTA_DASHBOARD=false), so nothing was asked',
      dashboardUrl: null,
    }
  }

  const dashboardUrl = `http://${config.dashboardBindAddress}:${config.dashboardPort}/dashboard/`

  try {
    const [routersRaw, servicesRaw] = await Promise.all([
      getJson(`${config.traefikApi}/api/http/routers`, config.traefikApiTimeoutMs) as Promise<RawRouter[]>,
      getJson(`${config.traefikApi}/api/http/services`, config.traefikApiTimeoutMs).catch(
        () => [] as RawService[],
      ) as Promise<RawService[]>,
    ])

    const servers = new Map<string, string[]>()
    for (const service of Array.isArray(servicesRaw) ? servicesRaw : []) {
      const urls = (service.loadBalancer?.servers ?? [])
        .map((server) => server.url ?? server.address ?? '')
        .filter((url) => url !== '')
      if (service.name) servers.set(service.name, urls)
    }

    const routers = (Array.isArray(routersRaw) ? routersRaw : [])
      .map((raw) => toRouter(raw, servers))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { ...base, available: true, reason: null, dashboardUrl, routers }
  } catch (cause) {
    // Degrades to today's label-derived view. A failure here is never a page
    // failure: the panel had an answer before Traefik was ever asked.
    return {
      ...base,
      available: false,
      reason: `could not reach the Traefik API at ${config.traefikApi}: ${String(cause)}`,
      dashboardUrl,
    }
  }
}

/**
 * A cache of its own, deliberately not the snapshot's. Traefik is a network
 * call; the snapshot is the page's budget.
 */
export function createVerdictCache(config: PanelConfig, ttlMs = config.traefikApiTtlMs) {
  let cached: { at: number; verdict: TraefikVerdict } | null = null
  let pending: Promise<TraefikVerdict> | null = null

  return {
    async get(force = false): Promise<TraefikVerdict> {
      const now = Date.now()
      if (!force && cached && now - cached.at < ttlMs) return cached.verdict
      if (!force && pending) return pending
      pending = fetchVerdict(config, now)
        .then((verdict) => {
          cached = { at: Date.now(), verdict }
          return verdict
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

export type VerdictCache = ReturnType<typeof createVerdictCache>

/**
 * The routers Traefik built for one container, matched on the hostnames the
 * panel already derived. Matching on the host rather than on a router name
 * keeps this working for a project that named its router itself.
 */
export function routersFor(container: ContainerSummary, verdict: TraefikVerdict): TraefikRouter[] {
  const wanted = new Set(container.urls.map((url) => url.host.toLowerCase()))
  if (wanted.size === 0) return []
  return verdict.routers.filter((router) => router.hosts.some((host) => wanted.has(host)))
}
