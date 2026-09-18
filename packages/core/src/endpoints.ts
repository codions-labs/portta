import {
  type Capability,
  type CapabilityId,
  capabilityById,
  type DetectedFacts,
  isLoopback,
  isUsable,
} from './capabilities.ts'
import { isHostnameRoutable, type ServiceKind } from './discovery.ts'
import { type AutoDomainProvider, autoDomainFor, ipFromAutoDomain } from './domain.ts'
import { hostLabel } from './hostname.ts'

/**
 * How a service can be reached, and by whom.
 *
 * A service does not have *an* address. It has as many as the host's
 * capabilities allow and the operator has turned on — an internal one always,
 * a private one over the VPN perhaps, a public one if somebody decided so —
 * and they coexist. Modelling this as a single `accessMode` was the mistake
 * this module exists to undo: it forced one answer where several are correct
 * at once, and it conflated *what a service is called* with *who may reach it*.
 *
 *   Service
 *   └── Exposures        what the operator turned on, one provider each
 *       └── Endpoints    the concrete URLs those produce
 *
 * See docs/development/adr/0024-capabilities-providers-endpoints.md.
 */

export const EXPOSURE_PROVIDERS = [
  'internal',
  'local',
  'lan',
  'tailscale',
  'tailscale-serve',
  'public-ip',
  'auto-domain',
  'custom-domain',
  'cloudflare-tunnel',
  'bridge',
] as const
export type ExposureProvider = (typeof EXPOSURE_PROVIDERS)[number]

/**
 * Who can reach an endpoint. This is the sentence the panel must never get
 * wrong, so it is one field with five values rather than a paragraph.
 */
export const ENDPOINT_SCOPES = ['internal', 'local', 'lan', 'private', 'protected', 'public'] as const
export type EndpointScope = (typeof ENDPOINT_SCOPES)[number]

/** Ordered least to most reachable, so a UI can sort and colour consistently. */
export const SCOPE_ORDER: Record<EndpointScope, number> = {
  internal: 0,
  local: 1,
  lan: 2,
  private: 3,
  protected: 4,
  public: 5,
}

export interface ProviderSpec {
  id: ExposureProvider
  scope: EndpointScope
  /** The capability that must be usable before this provider can be offered. */
  requires: CapabilityId | null
  /** Whether enabling it is a decision, or simply a fact about the container. */
  optional: boolean
}

export const PROVIDERS: ProviderSpec[] = [
  { id: 'internal', scope: 'internal', requires: null, optional: false },
  { id: 'local', scope: 'local', requires: 'localhost', optional: false },
  { id: 'lan', scope: 'lan', requires: 'lan', optional: true },
  { id: 'tailscale', scope: 'private', requires: 'tailscale', optional: true },
  { id: 'tailscale-serve', scope: 'private', requires: 'tailscale-https', optional: true },
  { id: 'public-ip', scope: 'public', requires: 'public-ipv4', optional: true },
  { id: 'auto-domain', scope: 'public', requires: 'auto-domain', optional: true },
  { id: 'custom-domain', scope: 'public', requires: 'custom-domain', optional: true },
  { id: 'cloudflare-tunnel', scope: 'public', requires: 'cloudflare-tunnel', optional: true },
  { id: 'bridge', scope: 'local', requires: null, optional: true },
]

export interface ServiceRef {
  project: string
  service: string
  container: string
  /** Branch, pull request or preview, when the endpoint should carry one. */
  context?: string | null
  /** The port the container listens on. */
  port: number
  /** HTTP services get hostnames; a datastore gets them only when the protocol is routable. */
  kind: ServiceKind
}

export interface Endpoint {
  provider: ExposureProvider
  url: string
  scope: EndpointScope
  /**
   * Whether this URL works right now. An endpoint can exist, be correct, and
   * still not answer — a name that resolves to an address Traefik does not
   * listen on is the case that made this field necessary.
   */
  usable: boolean
  /** Safe to send to somebody else: it works, and it works from where they are. */
  shareable: boolean
  /** Why it does not work, when it does not. Never speculative. */
  problem: string | null
}

export interface EndpointOptions {
  facts: DetectedFacts
  capabilities: Capability[]
  /** Which optional providers the operator turned on for this service. */
  exposures: ExposureProvider[]
  /** Whether Traefik serves these names over TLS. */
  scheme?: 'http' | 'https'
  /** Which wildcard DNS service derives a name from a bare address. */
  autoDomainProvider?: AutoDomainProvider
  /**
   * The published TCP entrypoint port. Required for a routable datastore to
   * emit hostname endpoints; ignored for HTTP.
   */
  tcpPort?: number
  /** Whether the container opted into a TCP router. A capability is not a route. */
  tcpRouted?: boolean
  /** A live loopback bridge, when one is open. Scope is always `local`. */
  bridge?: { host: string; port: number }
}

/**
 * Whether a base domain resolves to somewhere this Traefik is listening.
 *
 * `0.0.0.0` answers on every address the host has, a specific bind answers on
 * exactly one, and loopback answers only for `localhost` and the `.localhost`
 * names that resolve to it without any DNS at all.
 */
export function domainReachesBind(domain: string, facts: DetectedFacts): boolean {
  const bind = facts.bindAddress
  const isLocalName = domain === 'localhost' || domain.endsWith('.localhost')
  if (isLoopback(bind)) return isLocalName
  if (isLocalName) return true
  if (bind === '0.0.0.0' || bind === '::') return true
  // A specific address: the name has to encode that same one.
  return ipFromAutoDomain(domain) === bind
}

function endpoint(
  provider: ExposureProvider,
  url: string,
  scope: EndpointScope,
  usable: boolean,
  problem: string | null = null,
): Endpoint {
  return {
    provider,
    url,
    scope,
    usable,
    // Nothing bound to this machine alone can be sent to anybody, however well
    // it works locally. That is the distinction section 27 of the request asks
    // for: existing, accessible, useful, shareable are four different things.
    shareable: usable && !['internal', 'local'].includes(scope),
    problem,
  }
}

function pushTcpEndpoints(list: Endpoint[], _service: ServiceRef, options: EndpointOptions, label: string): void {
  const { facts, capabilities, exposures } = options
  const port = options.tcpPort
  if (!port) return
  const provider = options.autoDomainProvider ?? 'sslip.io'
  const enabled = new Set(exposures)
  const has = (id: CapabilityId) => isUsable(capabilityById(capabilities, id))
  const tcp = (
    chosen: ExposureProvider,
    host: string,
    scope: EndpointScope,
    usable: boolean,
    problem: string | null,
  ) => {
    list.push(endpoint(chosen, `${host}:${port}`, scope, usable, problem))
  }

  const localReaches = domainReachesBind(facts.resolvedDomain, facts)
  tcp(
    'local',
    `${label}.${facts.resolvedDomain}`,
    'local',
    localReaches,
    localReaches
      ? null
      : `${facts.resolvedDomain} does not resolve to an address Traefik listens on (${facts.bindAddress})`,
  )

  if (enabled.has('lan') && has('lan')) {
    const address = facts.privateIpv4[0] ?? ''
    const base = autoDomainFor(address, provider) ?? address
    const usable = domainReachesBind(base, facts)
    tcp(
      'lan',
      `${label}.${base}`,
      'lan',
      usable,
      usable ? null : `Traefik listens on ${facts.bindAddress} only, so nothing answers on ${address}`,
    )
  }

  if (enabled.has('tailscale') && has('tailscale')) {
    const address = facts.tailscale.ipv4 ?? ''
    const base = autoDomainFor(address, provider) ?? address
    const usable = domainReachesBind(base, facts)
    tcp(
      'tailscale',
      `${label}.${base}`,
      'private',
      usable,
      usable
        ? null
        : `Traefik listens on ${facts.bindAddress} only. Set the bind address to ${address} to serve the tailnet.`,
    )
  }

  if (enabled.has('auto-domain') && has('auto-domain')) {
    const base = autoDomainFor(facts.publicIpv4 ?? '', provider) ?? ''
    const usable = domainReachesBind(base, facts)
    tcp(
      'auto-domain',
      `${label}.${base}`,
      'public',
      usable,
      usable ? null : `${label}.${base} resolves here, but Traefik listens on ${facts.bindAddress} only`,
    )
  }

  if (enabled.has('custom-domain') && has('custom-domain')) {
    const usable = facts.bindAddress === '0.0.0.0' || facts.bindAddress === '::'
    tcp(
      'custom-domain',
      `${label}.${facts.customDomain}`,
      'public',
      usable,
      usable ? null : `${label}.${facts.customDomain} resolves here, but Traefik listens on ${facts.bindAddress} only`,
    )
  }
}

/**
 * Every endpoint a service has, given the host's capabilities and the
 * operator's choices.
 *
 * The internal endpoint is always present because it is always true. Every
 * other one appears only when its provider was turned on **and** the capability
 * behind it is usable — a capability alone never publishes anything.
 */
export function endpointsFor(service: ServiceRef, options: EndpointOptions): Endpoint[] {
  const { facts, capabilities, exposures } = options
  const scheme = options.scheme ?? (facts.tlsEnabled ? 'https' : 'http')
  const label = hostLabel({ project: service.project, service: service.service, context: service.context ?? null })
  const list: Endpoint[] = []

  // Always true, and the only address a datastore should ever be given
  // unless the protocol can be told apart by hostname.
  list.push(endpoint('internal', `${service.container}:${service.port}`, 'internal', true))

  if (options.bridge) {
    list.push(endpoint('bridge', `${options.bridge.host}:${options.bridge.port}`, 'local', true))
  }

  // A kind whose routing is unsupported or unevaluated still gets exactly
  // the internal endpoint (and a bridge, when one is open). Giving MySQL
  // an HTTP hostname would be offering something that cannot work.
  if (service.kind !== 'http') {
    if (isHostnameRoutable(service.kind) && options.tcpRouted === true && options.tcpPort) {
      pushTcpEndpoints(list, service, options, label)
    }
    return list.sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])
  }

  const provider = options.autoDomainProvider ?? 'sslip.io'
  const loopbackOnly = isLoopback(facts.bindAddress)
  const enabled = new Set(exposures)
  const has = (id: CapabilityId) => isUsable(capabilityById(capabilities, id))

  // The gateway's own front door: the base the gateway actually resolved,
  // which is the name Traefik baked into its rule. Whether it answers even
  // here depends on the address that name resolves to, so this is checked
  // rather than assumed — an auto domain on a loopback-only Traefik does not
  // work from the host either, and saying it does would be the same lie as
  // advertising `demo-web.localhost` to somebody on another continent.
  const localReaches = domainReachesBind(facts.resolvedDomain, facts)
  list.push(
    endpoint(
      'local',
      `${scheme}://${label}.${facts.resolvedDomain}`,
      'local',
      localReaches,
      localReaches
        ? null
        : `${facts.resolvedDomain} does not resolve to an address Traefik listens on (${facts.bindAddress})`,
    ),
  )

  if (enabled.has('lan') && has('lan')) {
    const address = facts.privateIpv4[0] ?? ''
    // A bare address cannot carry a per-service name, and Traefik routes by
    // Host. The wildcard DNS services answer for private ranges too, so the
    // same derivation that gives a public host its names gives a LAN host its
    // own — one label, no record to create, and Traefik matches it unchanged.
    const base = autoDomainFor(address, provider) ?? address
    const usable = domainReachesBind(base, facts)
    list.push(
      endpoint(
        'lan',
        `${scheme}://${label}.${base}`,
        'lan',
        usable,
        usable ? null : `Traefik listens on ${facts.bindAddress} only, so nothing answers on ${address}`,
      ),
    )
  }

  if (enabled.has('tailscale') && has('tailscale')) {
    const address = facts.tailscale.ipv4 ?? ''
    // Same derivation on the tailnet address. `tailscale-serve` below is the
    // alternative that uses the node's own name, and it cannot carry more than
    // one service per port, which is why both exist.
    const base = autoDomainFor(address, provider) ?? address
    const usable = domainReachesBind(base, facts)
    list.push(
      endpoint(
        'tailscale',
        `${scheme}://${label}.${base}`,
        'private',
        usable,
        usable
          ? null
          : `Traefik listens on ${facts.bindAddress} only. Set the bind address to ${address} to serve the tailnet.`,
      ),
    )
  }

  if (enabled.has('tailscale-serve') && has('tailscale-https')) {
    // Serve gives one hostname per node, multiplexed by port or path — never a
    // subdomain, which Tailscale does not offer. Verified against a real
    // tailnet, where Serve rewrites Host to the node name, so Traefik's
    // host-based routing cannot sit behind it.
    list.push(endpoint('tailscale-serve', `https://${facts.tailscale.magicDns}`, 'private', true))
  }

  if (enabled.has('public-ip') && has('public-ipv4')) {
    const usable = !loopbackOnly && (facts.bindAddress === '0.0.0.0' || facts.bindAddress === facts.publicIpv4)
    list.push(
      endpoint(
        'public-ip',
        `${scheme}://${facts.publicIpv4}`,
        'public',
        usable,
        usable ? null : `Traefik listens on ${facts.bindAddress} only, so nothing answers from the internet`,
      ),
    )
  }

  if (enabled.has('auto-domain') && has('auto-domain')) {
    const base = autoDomainFor(facts.publicIpv4 ?? '', provider) ?? ''
    const usable = domainReachesBind(base, facts)
    list.push(
      endpoint(
        'auto-domain',
        `${scheme}://${label}.${base}`,
        'public',
        usable,
        usable ? null : `${label}.${base} resolves here, but Traefik listens on ${facts.bindAddress} only`,
      ),
    )
  }

  if (enabled.has('custom-domain') && has('custom-domain')) {
    // A custom wildcard is a record the operator pointed somewhere; it reaches
    // this gateway when Traefik answers on every interface. A specific bind
    // cannot be checked from here without resolving the name, which `doctor`
    // does over the network and this pure function deliberately does not.
    const usable = facts.bindAddress === '0.0.0.0' || facts.bindAddress === '::'
    list.push(
      endpoint(
        'custom-domain',
        `${scheme}://${label}.${facts.customDomain}`,
        'public',
        usable,
        usable
          ? null
          : `${label}.${facts.customDomain} resolves here, but Traefik listens on ${facts.bindAddress} only`,
      ),
    )
  }

  // Deliberately keyed on `tunnelConfigured` rather than on the capability
  // being usable: a tunnel that is set up and down must still show its URL and
  // say what is wrong. Dropping the endpoint would hide the one fact the
  // operator needs.
  if (enabled.has('cloudflare-tunnel') && facts.cloudflare.tunnelConfigured && facts.cloudflare.zone) {
    const zone = facts.cloudflare.zone
    // The tunnel is an outbound connection, so this endpoint does not depend on
    // the bind address the way every other public one does: cloudflared dials
    // Traefik from inside, and the edge terminates TLS regardless.
    const protectedByAccess = facts.cloudflare.accessConfigured
    list.push(
      endpoint(
        'cloudflare-tunnel',
        `https://${label}.${zone}`,
        protectedByAccess ? 'protected' : 'public',
        facts.cloudflare.tunnelConnected,
        facts.cloudflare.tunnelConnected ? null : 'the tunnel connector holds no connection to the Cloudflare edge',
      ),
    )
  }

  return list.sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])
}

/**
 * The one URL to show first.
 *
 * "Most reachable that actually works" — never the most reachable that merely
 * exists. A panel read over the internet advertising `demo-web.localhost` is
 * the failure this ordering prevents.
 */
export function primaryEndpoint(endpoints: Endpoint[]): Endpoint | null {
  const usable = endpoints.filter((entry) => entry.usable && entry.scope !== 'internal')
  if (usable.length === 0) return endpoints.find((entry) => entry.scope === 'internal') ?? null
  return usable.reduce((best, entry) => (SCOPE_ORDER[entry.scope] > SCOPE_ORDER[best.scope] ? entry : best))
}
