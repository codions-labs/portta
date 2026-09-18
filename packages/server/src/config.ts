// Runtime configuration for the panel.
//
// Every value the panel reports comes from the same environment Compose was
// invoked with, so the panel and the CLI always describe the same gateway.
// Gateway-wide defaults are owned by portta-core.

import { existsSync, readFileSync } from 'node:fs'
import { attachment, BRIDGE_IMAGE, isTrue, loadGatewayConfig, resolveDatabase } from 'portta-core'

export { isTrue }

function env(key: string, fallback: string): string {
  const value = process.env[key]
  return value === undefined || value === '' ? fallback : value
}

function optional(key: string): string | null {
  const value = process.env[key]
  return value === undefined || value === '' ? null : value
}

export interface PanelConfig {
  /** Docker Engine API base URL, always the panel's own socket proxy. */
  dockerApi: string
  host: string
  port: number
  envFile: string
  versionFile: string
  uiDir: string
  docsDir: string
  profile: string
  /** Host path of Projects Home. The panel never opens it; the collector does. */
  projectsHome: string | null
  projectName: string
  network: string
  controlNetwork: string
  accessNetwork: string
  webNetwork: string
  /**
   * The SQLite file this panel opens.
   *
   * Always a path, never null: there is nothing to configure and nothing to
   * fail to resolve, so a panel that cannot start is one whose file cannot be
   * opened rather than one that was never told where to look (ADR 0037).
   */
  databaseFile: string
  domain: string
  /** How the base domain was chosen: local, auto or custom. */
  domainMode: string
  domainProblem: string | null
  publicIp: string | null
  autoDomainProvider: string
  privateDomain: string | null
  publicDomain: string | null
  bindAddress: string
  httpPort: string
  httpsPort: string
  tlsEnabled: boolean
  tlsMode: string
  acmeEmailSet: boolean
  acmeCaServer: string
  acmeDnsProvider: string
  tailscaleEnabled: boolean
  tailscaleHostname: string
  publicEnabled: boolean
  cloudflareEnabled: boolean
  cloudflareZone: string | null
  /** Whether the connector is part of the running stack. */
  tunnelEnabled: boolean
  /** The domain whose wildcard reaches this gateway through the tunnel. */
  tunnelZone: string | null
  /**
   * Where the connector's generated config and its credential live. Mounted
   * read-write because this is the one credential the panel is asked to set up;
   * the directory is 0700 and the credentials file 0600.
   */
  tunnelDir: string
  dashboardEnabled: boolean
  dashboardBindAddress: string
  dashboardPort: string
  tcpEnabled: boolean
  tcpPorts: Record<string, number>
  bridgeImage: string
  /** How long to wait before checking a new bridge actually stayed up. */
  bridgeSettleMs: number
  panelVersion: string
  gatewayVersion: string
  /** Read-only mode refuses every mutating endpoint. */
  readOnly: boolean
  /** Serve the self-contained API browser. The OpenAPI document is always served. */
  apiDocs: boolean
  /**
   * Serve the MCP tools over Streamable HTTP at `POST /api/mcp`. Off by
   * default: it is a second way in for agents, and it is reachable from
   * wherever the panel is (ADR 0054).
   */
  mcpHttp: boolean
  /**
   * The guides at `/docs`. Static text with no host information in it, so a
   * routed panel may serve it -- unlike the API console, which issues real
   * requests and keeps the conservative default.
   */
  docs: boolean
  /** Where the panel can be reached from: `local` or `vpn`. */
  webExpose: string
  /**
   * `disabled` or `required`. The panel signs people in itself now; `disabled`
   * means every request is the local operator, which `packages/auth` allows
   * only on loopback.
   */
  authMode: string
  /**
   * What sessions and tokens are signed with. Never leaves this process and
   * never appears in a response: the API reports whether it is set, the way it
   * treats TS_AUTHKEY.
   */
  authSecret: string
  /** The origin a browser reaches the panel on, for cookies and redirects. */
  panelUrl: string
  /** Extra origins a browser may send a write from, comma-separated. */
  panelTrustedOrigins: string
  /** Private credential catalogue shared with the auth process read-only. */
  authStore: string
  panelAdvertisedHost: string | null
  webExternalPort: string
  /** Traefik's dynamic configuration directory, mounted read-write. */
  dynamicDir: string
  /** Where `portta repos scan` writes, mounted read-only. */
  gitDir: string
  /** Past this age, collected Git metadata is marked stale rather than shown. */
  gitStaleSeconds: number
  /** Where the CLI metrics collector writes current.json and history. */
  metricsDir: string
  /** Past this age, current.json is marked stale. */
  metricsStaleSeconds: number
  /** Host-written readiness report. The panel only reads this directory. */
  environmentDir: string
  /** Readiness probes are deliberately slower than resource metrics. */
  environmentStaleSeconds: number
  /** Where the panel writes the runner request. Read-write, host-owned. */
  runnerDir: string
  /** Tunnel records `portta remote` wrote. Cleaned on project removal. */
  accessDir: string
  /** Portta-owned SSH key material. Never exposed by the API. */
  sshDir: string
  /** Traefik's own API, resolved per attachment. Read-only, and opt-in. */
  traefikApi: string
  traefikApiTtlMs: number
  traefikApiTimeoutMs: number
  /** Off by default: with this false the panel behaves exactly as it did. */
  /** A path, never the PEM: the panel can write .env, and must not hold a key. */
  /** Configurable from the first commit, so Enterprise Server is not a rewrite. */
  /**
   * The host daemon (`portta host serve`), for modules whose work needs the
   * host. Null unless configured: no module proxy reaches anywhere by default.
   */
  hostUrl: string | null
  /** The daemon's token, mounted read-only. A path, never the value. */
  hostTokenFile: string
}

export function loadConfig(overrides: Partial<PanelConfig> = {}): PanelConfig {
  const versionFile = env('PORTTA_RUNTIME_VERSION_FILE', '/app/state/VERSION')
  // An installed runtime carries a generated VERSION file; an image carries
  // its identity as an environment value, which lets a source checkout build
  // without a generated file.
  const installed = readVersion(versionFile) || env('PORTTA_RUNTIME_VERSION', 'unknown')
  const gateway = loadGatewayConfig(process.env)
  const config: PanelConfig = {
    dockerApi: env('PORTTA_RUNTIME_DOCKER_API', 'http://web-socket-proxy:2375'),
    host: env('PORTTA_RUNTIME_HOST', '0.0.0.0'),
    port: Number(env('PORTTA_RUNTIME_PORT', '8081')),
    envFile: env('PORTTA_RUNTIME_ENV_FILE', '/app/state/.env'),
    versionFile,
    uiDir: env('PORTTA_RUNTIME_UI_DIR', './dist/ui'),
    docsDir: env('PORTTA_RUNTIME_DOCS_DIR', './dist/docs'),
    profile: gateway.profile,
    projectsHome: optional('PORTTA_PROJECTS_HOME'),
    projectName: gateway.projectName,
    network: gateway.network,
    controlNetwork: gateway.controlNetwork,
    accessNetwork: gateway.accessNetwork,
    webNetwork: gateway.webNetwork,
    databaseFile: resolveDatabase(process.env).path,
    domain: gateway.domain,
    domainMode: gateway.domainMode,
    domainProblem: gateway.domainProblem,
    publicIp: gateway.publicIp,
    autoDomainProvider: env('PORTTA_AUTO_DOMAIN_PROVIDER', 'sslip.io'),
    privateDomain: gateway.privateDomain,
    publicDomain: gateway.publicDomain,
    bindAddress: gateway.bindAddress,
    httpPort: String(gateway.httpPort),
    httpsPort: String(gateway.httpsPort),
    tlsEnabled: gateway.tlsEnabled,
    tlsMode: gateway.tlsMode,
    acmeEmailSet: Boolean(optional('ACME_EMAIL')),
    acmeCaServer: env('ACME_CA_SERVER', 'https://acme-v02.api.letsencrypt.org/directory'),
    acmeDnsProvider: env('ACME_DNS_PROVIDER', 'cloudflare'),
    tailscaleEnabled: gateway.tailscaleEnabled,
    tailscaleHostname: env('TAILSCALE_HOSTNAME', 'portta'),
    publicEnabled: gateway.publicEnabled,
    cloudflareEnabled: isTrue(process.env.CLOUDFLARE_ENABLED),
    cloudflareZone: optional('CLOUDFLARE_ZONE'),
    tunnelEnabled: isTrue(process.env.CLOUDFLARE_TUNNEL_ENABLED),
    tunnelZone: optional('CLOUDFLARE_TUNNEL_ZONE'),
    tunnelDir: env('PORTTA_RUNTIME_TUNNEL_DIR', '/app/state/cloudflared'),
    dashboardEnabled: gateway.dashboardEnabled,
    dashboardBindAddress: env('PORTTA_DASHBOARD_BIND_ADDRESS', '127.0.0.1'),
    dashboardPort: env('PORTTA_DASHBOARD_PORT', '8080'),
    tcpEnabled: isTrue(process.env.PORTTA_TCP),
    tcpPorts: {
      postgres: Number(env('PORTTA_TCP_POSTGRES_PORT', '5432')),
      redis: Number(env('PORTTA_TCP_REDIS_PORT', '6379')),
    },
    // The panel must create the very same bridge the CLI creates, or
    // `portta access list` would not recognise it. One pin, in portta-core.
    bridgeImage: env('PORTTA_RUNTIME_BRIDGE_IMAGE', BRIDGE_IMAGE),
    bridgeSettleMs: Number(env('PORTTA_RUNTIME_BRIDGE_SETTLE_MS', '800')),
    panelVersion: env('PORTTA_RUNTIME_VERSION', installed),
    gatewayVersion: installed,
    readOnly: isTrue(process.env.PORTTA_RUNTIME_READ_ONLY),
    apiDocs: false,
    mcpHttp: isTrue(process.env.PORTTA_MCP_HTTP),
    docs: isTrue(env('PORTTA_RUNTIME_DOCS', 'true')),
    webExpose: env('PORTTA_WEB_EXPOSE', 'local'),
    authMode: env('PORTTA_AUTH_MODE', 'disabled'),
    authSecret: env('PORTTA_AUTH_SECRET', ''),
    panelUrl: env('PORTTA_PANEL_URL', ''),
    panelTrustedOrigins: env('PORTTA_PANEL_TRUSTED_ORIGINS', ''),
    authStore: env('PORTTA_RUNTIME_AUTH_STORE', '/app/state/auth/protections.json'),
    panelAdvertisedHost: optional('PORTTA_PANEL_ADVERTISED_HOST'),
    webExternalPort: env('PORTTA_WEB_PORT', '8081'),
    dynamicDir: env('PORTTA_RUNTIME_DYNAMIC_DIR', '/app/state/traefik-dynamic'),
    gitDir: env('PORTTA_RUNTIME_GIT_DIR', '/app/state/git'),
    gitStaleSeconds: Number(env('PORTTA_RUNTIME_GIT_STALE_SECONDS', '600')),
    metricsDir: env('PORTTA_RUNTIME_METRICS_DIR', '/app/state/metrics'),
    metricsStaleSeconds: Number(env('PORTTA_RUNTIME_METRICS_STALE_SECONDS', '30')),
    environmentDir: env('PORTTA_RUNTIME_ENVIRONMENT_DIR', '/app/state/environment'),
    environmentStaleSeconds: Number(env('PORTTA_RUNTIME_ENVIRONMENT_STALE_SECONDS', '900')),
    runnerDir: env('PORTTA_RUNTIME_RUNNER_DIR', '/app/state/runner'),
    accessDir: env('PORTTA_RUNTIME_ACCESS_DIR', '/app/state/access'),
    sshDir: env('PORTTA_RUNTIME_SSH_DIR', '/app/state/ssh'),
    traefikApi: env('PORTTA_RUNTIME_TRAEFIK_API', defaultTraefikApi()),
    traefikApiTtlMs: Number(env('PORTTA_RUNTIME_TRAEFIK_API_TTL_MS', '7000')),
    traefikApiTimeoutMs: Number(env('PORTTA_RUNTIME_TRAEFIK_API_TIMEOUT_MS', '1500')),
    hostUrl: optional('PORTTA_HOST_URL'),
    hostTokenFile: env('PORTTA_RUNTIME_HOST_TOKEN_FILE', '/app/state/host/token'),
    ...overrides,
  }
  if (overrides.apiDocs === undefined) {
    const configured = optional('PORTTA_RUNTIME_API_DOCS')
    config.apiDocs = configured === null ? !isRouted(config) : isTrue(configured)
  }
  return config
}

/**
 * Where Traefik's API answers. The internal port is always 8080; only the
 * published one is configurable.
 *
 * The attachment decides the name: under docker/compose/attach/tailscale.yaml
 * Traefik runs inside the Tailscale container's namespace and has none of its
 * own, so the same API answers on `tailscale`. `attachment()` in portta-core
 * is the one implementation of that rule; it is also what selects the overlay,
 * and the two must not be able to disagree.
 */
function defaultTraefikApi(): string {
  const attached = attachment({
    profile: env('PORTTA_PROFILE', 'local'),
    tailscaleEnabled: isTrue(process.env.TAILSCALE_ENABLED),
  })
  return `http://${attached === 'tailscale' ? 'tailscale' : 'traefik'}:8080`
}

function readVersion(file: string): string {
  try {
    if (!existsSync(file)) return 'unknown'
    return readFileSync(file, 'utf8').trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** True when the panel is reachable beyond the host's own loopback. */
export function isRouted(config: PanelConfig): boolean {
  return config.webExpose !== 'local'
}

/** True when the panel asks who you are before answering. */
export function isProtected(config: PanelConfig): boolean {
  return config.authMode === 'required' && config.authSecret !== ''
}

/** The scheme Traefik answers on, given the resolved TLS settings. */
export function schemeFor(config: PanelConfig): 'http' | 'https' {
  return config.tlsEnabled ? 'https' : 'http'
}
