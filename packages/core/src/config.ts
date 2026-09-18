import { type DomainMode, resolveDomain } from './domain.ts'

export const AUTH_BUILD_FILE = 'docker/compose/features/auth-build.yaml'
export const AUTH_DEV_FILE = 'docker/compose/features/auth-dev.yaml'
export const PANEL_HOST_FILE = 'docker/compose/features/panel-host.yaml'

export const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled'])

export function isTrue(value: string | undefined | null): boolean {
  return TRUTHY.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
}

/** The three profiles, as one list so nothing has to restate them. */
export const GATEWAY_PROFILES = ['local', 'remote-private', 'remote-public'] as const
export type GatewayProfile = (typeof GATEWAY_PROFILES)[number]

export function isGatewayProfile(value: string): value is GatewayProfile {
  return (GATEWAY_PROFILES as readonly string[]).includes(value)
}

/**
 * How the panel is reached. Deliberately independent of the gateway profile:
 * publishing the panel must never publish an application, so `public` here is
 * not `remote-public` there. See docs/development/adr/0021-panel-access-modes.md.
 *
 *   local      loopback only; reach it over an SSH tunnel
 *   tailscale  bound to the node's tailnet address, nothing on the public NIC
 *   public     Traefik's own `panel` entrypoint on every interface
 *   vpn        routed by Traefik at PORTTA_WEB_HOST.<domain> (remote-private)
 *   domain     routed by Traefik on one hostname of the gateway's own domain
 *
 * `public` and `domain` need `PORTTA_AUTH_MODE=required`: the panel is what
 * stands in front of the panel there. The other three may run without it —
 * see PANEL_ACCESS_WITHOUT_AUTH.
 */
export const PANEL_ACCESS_MODES = ['local', 'tailscale', 'public', 'vpn', 'domain'] as const
export type PanelAccess = (typeof PANEL_ACCESS_MODES)[number]

export function isPanelAccess(value: string): value is PanelAccess {
  return (PANEL_ACCESS_MODES as readonly string[]).includes(value)
}

/**
 * The access modes where "no login" is a choice rather than an open door.
 *
 * `local` is loopback: reaching the panel already means having the machine.
 * `tailscale` and `vpn` put a network in front of it that authenticates on its
 * own — a tailnet node is a device somebody enrolled, and the private domain is
 * only resolvable and routable inside the VPN. In all three, the reachable set
 * is already an authenticated set, so a second credential secures nothing that
 * was not already closed.
 *
 * `public` and `domain` are the opposite: the panel answers whoever finds the
 * address. Those stay refused at boot rather than warned about
 * (docs/development/adr/0051-authentication-is-optional-inside-a-trusted-network.md).
 */
export const PANEL_ACCESS_WITHOUT_AUTH: readonly PanelAccess[] = ['local', 'tailscale', 'vpn']

export function allowsDisabledAuth(access: PanelAccess): boolean {
  return PANEL_ACCESS_WITHOUT_AUTH.includes(access)
}

/**
 * Whether the panel asks who you are.
 *
 * The two words are the operator's, and they are what `.env` holds; the panel's
 * own process calls the same two states `protected` and `open`, because inside
 * it the question is what a request already is rather than what a host was
 * configured to do.
 */
export const PANEL_AUTH_MODES = ['disabled', 'required'] as const
export type PanelAuthMode = (typeof PANEL_AUTH_MODES)[number]

export function isPanelAuthMode(value: string): value is PanelAuthMode {
  return (PANEL_AUTH_MODES as readonly string[]).includes(value)
}

export interface GatewayConfig {
  profile: GatewayProfile
  projectName: string
  network: string
  controlNetwork: string
  accessNetwork: string
  webNetwork: string
  domain: string
  bindAddress: string
  httpPort: number
  httpsPort: number
  tlsEnabled: boolean
  tlsMode: string
  /** 'dns' issues one wildcard and needs a provider credential; 'http' issues per hostname and needs :80. */
  acmeChallenge: string
  tailscaleEnabled: boolean
  publicEnabled: boolean
  publicDomain: string | null
  privateDomain: string | null
  dashboardEnabled: boolean
  tcpEnabled: boolean
  webEnabled: boolean
  webDev: boolean
  webBuild: boolean
  webExpose: PanelAccess
  /** How the base domain was chosen, and what it could not honour. */
  domainMode: DomainMode
  domainProblem: string | null
  publicIp: string | null
  webPort: number
  webReadOnly: boolean
  /** The Task Flow module: the panel reaches the host daemon. Only meaningful with the panel on. */
  /**
   * Whether the panel signs people in.
   *
   * `disabled` makes every request the local operator, which is only legal on
   * loopback: the panel's own process refuses to start any other way, and
   * `portta web up --expose` refuses before it gets there. The value is here
   * rather than only in the panel's environment so the CLI, `doctor` and the
   * installer can all say what mode a host is in without starting anything.
   */
  authMode: PanelAuthMode
  /** Whether the Cloudflare Tunnel connector runs beside the gateway. */
  tunnelEnabled: boolean
  /** The zone whose wildcard the tunnel carries, when one is configured. */
  tunnelZone: string | null
}

function value(env: Record<string, string | undefined>, key: string, fallback: string): string {
  return env[key] || fallback
}

function optional(env: Record<string, string | undefined>, key: string): string | null {
  return env[key] || null
}

export function loadGatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const profile = value(env, 'PORTTA_PROFILE', 'local')
  if (!isGatewayProfile(profile)) throw new Error(`unknown profile: ${profile}`)
  const webExpose = value(env, 'PORTTA_WEB_EXPOSE', 'local')
  if (!isPanelAccess(webExpose)) throw new Error(`unknown panel access mode: ${webExpose}`)
  const authMode = value(env, 'PORTTA_AUTH_MODE', 'disabled')
  if (!isPanelAuthMode(authMode)) {
    throw new Error(`unknown panel authentication mode: ${authMode} (disabled or required)`)
  }
  const publicDomain = optional(env, 'PUBLIC_DOMAIN')
  const privateDomain = optional(env, 'PRIVATE_DOMAIN')

  // The base every project hostname is built on, from the mode rather than a
  // bare value. `custom` uses PORTTA_DOMAIN as given.
  const domainMode = value(env, 'PORTTA_DOMAIN_MODE', 'local')
  const resolution = resolveDomain({
    mode: domainMode,
    publicIp: optional(env, 'PORTTA_PUBLIC_IP'),
    provider: optional(env, 'PORTTA_AUTO_DOMAIN_PROVIDER'),
    configured: optional(env, 'PORTTA_DOMAIN'),
  })
  let domain = resolution.domain
  let bindAddress = value(env, 'PORTTA_BIND_ADDRESS', '127.0.0.1')

  // The per-profile domains stay what they were: a wildcard the operator owns
  // for that audience. An auto or custom base fills in where one is unset, so
  // going public does not require buying a domain first.
  if (profile === 'remote-private') domain = privateDomain ?? domain
  if (profile === 'remote-public') {
    const effective = publicDomain ?? (resolution.mode === 'local' ? null : resolution.domain)
    if (!effective) {
      throw new Error('profile remote-public requires PUBLIC_DOMAIN, or a project domain mode that yields one')
    }
    domain = effective
    bindAddress = '0.0.0.0'
  }
  // The `public` panel entrypoint is a port on the Traefik container. Under the
  // Tailscale attachment Traefik has no network namespace of its own, so there
  // is no port to publish and the mode cannot be honoured.
  if (webExpose === 'public' && profile !== 'local' && isTrue(env.TAILSCALE_ENABLED)) {
    throw new Error('panel access `public` is not available while Traefik runs inside the Tailscale namespace')
  }
  return {
    profile: profile as GatewayProfile,
    projectName: value(env, 'PORTTA_PROJECT_NAME', 'portta'),
    network: value(env, 'PORTTA_NETWORK', 'portta'),
    controlNetwork: value(env, 'PORTTA_CONTROL_NETWORK', 'portta-control'),
    accessNetwork: value(env, 'PORTTA_ACCESS_NETWORK', 'portta-access'),
    webNetwork: value(env, 'PORTTA_WEB_NETWORK', 'portta-web'),
    domain,
    bindAddress,
    httpPort: Number(value(env, 'PORTTA_HTTP_PORT', '80')),
    httpsPort: Number(value(env, 'PORTTA_HTTPS_PORT', '443')),
    tlsEnabled: isTrue(env.TLS_ENABLED),
    tlsMode: value(env, 'TLS_MODE', 'local'),
    acmeChallenge: value(env, 'ACME_CHALLENGE', 'dns'),
    tailscaleEnabled: isTrue(env.TAILSCALE_ENABLED),
    publicEnabled: isTrue(env.PUBLIC_ENABLED),
    publicDomain,
    privateDomain,
    dashboardEnabled: isTrue(env.PORTTA_DASHBOARD),
    tcpEnabled: isTrue(env.PORTTA_TCP),
    webEnabled: isTrue(env.PORTTA_WEB),
    webDev: isTrue(env.PORTTA_WEB_DEV),
    webBuild: isTrue(env.PORTTA_WEB_BUILD),
    webExpose,
    domainMode: resolution.mode,
    domainProblem: resolution.problem,
    publicIp: optional(env, 'PORTTA_PUBLIC_IP'),
    webPort: Number(value(env, 'PORTTA_WEB_PORT', '8081')),
    webReadOnly: isTrue(env.PORTTA_WEB_READ_ONLY),
    authMode,
    tunnelEnabled: isTrue(env.CLOUDFLARE_TUNNEL_ENABLED),
    tunnelZone: optional(env, 'CLOUDFLARE_TUNNEL_ZONE'),
  }
}

/**
 * How Traefik is attached to the network, which decides both the overlay set
 * and where Traefik's API answers.
 *
 * With docker/compose/attach/host.yaml Traefik has its own namespace and is
 * reachable as `traefik`. With docker/compose/attach/tailscale.yaml it runs
 * inside the Tailscale container's namespace and has no name of its own, so
 * the same API answers on `tailscale`. See
 * docs/development/adr/0007-tailscale-sidecar.md.
 */
export function attachment(config: { profile: string; tailscaleEnabled: boolean }): 'tailscale' | 'host' {
  return config.profile !== 'local' && config.tailscaleEnabled ? 'tailscale' : 'host'
}

/**
 * The overlays live under docker/compose/, one directory per axis of the decision.
 *
 * This is the single compose-file selection contract used by the CLI.
 */
export function composeFiles(config: GatewayConfig): string[] {
  const attached = attachment(config)
  const files = ['docker/compose/compose.yaml', `docker/compose/attach/${attached}.yaml`]
  if (config.profile === 'local') {
    files.push('docker/compose/profiles/local.yaml')
    if (config.tlsEnabled && config.tlsMode === 'local') files.push('docker/compose/profiles/local-tls.yaml')
  } else {
    // Redirecting :80 to :443 without a certificate the browser accepts turns a
    // working URL into a warning page, so the TLS overlay is applied only when
    // there is TLS. See docs/development/adr/0022-project-domain-modes.md.
    if (config.tlsEnabled) {
      // Exactly one challenge overlay rides with the shared TLS one. DNS-01 is
      // the default because it is the only challenge that issues a wildcard,
      // and the only one a private gateway can use at all; HTTP-01 is the
      // trade for a public host that would rather not hold a DNS credential.
      files.push('docker/compose/profiles/remote-tls.yaml')
      files.push(
        config.acmeChallenge === 'http'
          ? 'docker/compose/profiles/remote-tls-http.yaml'
          : 'docker/compose/profiles/remote-tls-dns.yaml',
      )
    } else files.push('docker/compose/profiles/remote.yaml')
  }
  if (config.profile === 'remote-public') files.push('docker/compose/profiles/public.yaml')
  if (config.dashboardEnabled) {
    files.push(
      attached === 'tailscale'
        ? 'docker/compose/features/dashboard-tailscale.yaml'
        : 'docker/compose/features/dashboard.yaml',
    )
  }
  if (config.tcpEnabled)
    files.push(
      attached === 'tailscale' ? 'docker/compose/features/tcp-tailscale.yaml' : 'docker/compose/features/tcp.yaml',
    )
  if (config.webEnabled) {
    // The panel's database is a file under $PORTTA_HOME, bind-mounted by
    // web.yaml. There is no database service to select
    // (docs/development/adr/0037-sqlite-is-the-panel-database.md).
    files.push('docker/compose/features/web.yaml')
    // Exactly one overlay owns the panel's front door, so `public` and a host
    // publish can never both claim PORTTA_WEB_PORT.
    if (config.webExpose === 'public') files.push('docker/compose/features/panel-public.yaml')
    // `domain` owns the panel's front door too: a host publish alongside a
    // router would be a second, unauthenticated way in.
    else if (config.webExpose !== 'domain') files.push('docker/compose/features/web-bind.yaml')
    if (config.webBuild) files.push('docker/compose/features/web-build.yaml')
    if (config.webDev) files.push('docker/compose/features/web-dev.yaml')
    if (config.webExpose === 'vpn') files.push('docker/compose/features/web-vpn.yaml')
    if (config.webExpose === 'domain') {
      files.push('docker/compose/features/panel-domain.yaml')
    }
    // The panel's way to the host daemon: a name for the host, and the token.
    // Always, because Issues are read through it (ADR 0018) and the panel has
    // no other way to reach `gh`. A daemon that is not running degrades the
    // surfaces that need it rather than the panel.
    files.push(PANEL_HOST_FILE)
  }
  // Auth is a gateway service, not a panel extra. Its local-build overlay is
  // selected by the same flags as the panel.
  if (config.webBuild) files.push(AUTH_BUILD_FILE)
  if (config.webDev) files.push(AUTH_DEV_FILE)
  // Last, and independent of every other axis: the connector is an extra way in,
  // never a replacement for one. A gateway can carry a tunnel while still
  // publishing ports, or while publishing none at all.
  if (config.tunnelEnabled) files.push('docker/compose/features/cloudflare-tunnel.yaml')
  return files
}
