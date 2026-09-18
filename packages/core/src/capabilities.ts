/**
 * What this instance can actually do.
 *
 * A capability is that property, detected rather than configured. It says only
 * that something **can** be used. It never means anything is exposed: choosing
 * to publish a service is a separate, deliberate act, one service at a time.
 * See docs/development/adr/0024-capabilities-providers-endpoints.md.
 *
 * Detection lives outside this package: the panel's services read the host and
 * the installation (`packages/server/src/services/access.ts`) and hand this
 * module plain facts, so the same evidence yields the same verdict wherever it
 * is read. Keeping the probes out there is what lets these verdicts be tested
 * without a host, and what keeps this package free of process execution.
 */

export const CAPABILITIES = [
  'localhost',
  'lan',
  'tailscale',
  'tailscale-dns',
  'tailscale-https',
  'tailscale-funnel',
  'public-ipv4',
  'auto-domain',
  'custom-domain',
  'cloudflare-tunnel',
  'cloudflare-access',
  'https',
] as const
export type CapabilityId = (typeof CAPABILITIES)[number]

/**
 * Six states, because "yes/no" loses the distinction that matters most: the
 * difference between something this host cannot do at all and something it
 * could do as soon as somebody decides to.
 *
 *   unavailable   nothing here supports it
 *   available     usable right now, with no further setup
 *   configurable  the pieces are present; a decision is missing
 *   configured    set up, but not currently carrying traffic
 *   active        set up and working
 *   error         set up and broken, which is the one worth surfacing
 */
export const CAPABILITY_STATES = ['unavailable', 'available', 'configurable', 'configured', 'active', 'error'] as const
export type CapabilityState = (typeof CAPABILITY_STATES)[number]

export interface Capability {
  id: CapabilityId
  state: CapabilityState
  /** The address, hostname or version that makes this concrete, when there is one. */
  detail: string | null
  /** Why it is not usable, or what is wrong with it. Never invented. */
  problem: string | null
  /** The single next step, when there is one worth naming. */
  hint: string | null
}

export interface TailscaleFacts {
  installed: boolean
  connected: boolean
  ipv4: string | null
  /** The node's full MagicDNS name, e.g. `node.tailnet.ts.net`. */
  magicDns: string | null
  /**
   * Whether the tailnet issues TLS certificates. Off by default, and both
   * Serve-over-HTTPS and Funnel are gated behind it — verified on a real
   * tailnet, where `tailscale cert` answers "your Tailscale account does not
   * support getting TLS certs" until an admin enables it.
   */
  httpsCerts: boolean
  /** Whether the policy file grants this node the `funnel` attribute. */
  funnel: boolean
  /** Tailscale Services require a tagged node; a user-owned node is refused. */
  tagged: boolean
}

export interface CloudflareFacts {
  /** `cloudflared` is runnable, as a binary or as an image already pulled. */
  connectorAvailable: boolean
  /** A tunnel has credentials and an ingress configuration on this host. */
  tunnelConfigured: boolean
  /** The connector currently holds registered connections to the edge. */
  tunnelConnected: boolean
  /** An Access application protects at least one of the published hostnames. */
  accessConfigured: boolean
  /** The zone whose wildcard points at the tunnel, when one is configured. */
  zone: string | null
}

export interface DetectedFacts {
  /** This host's address as the internet sees it, or null behind NAT/CGNAT. */
  publicIpv4: string | null
  /** Non-loopback addresses on private ranges: a home lab, a VPC, a LAN. */
  privateIpv4: string[]
  tailscale: TailscaleFacts
  cloudflare: CloudflareFacts
  /** A wildcard the operator owns and configured, e.g. `dev.example.com`. */
  customDomain: string | null
  /** The base the gateway resolved, from PORTTA_DOMAIN_MODE. */
  resolvedDomain: string
  /** Whether Traefik terminates TLS itself. */
  tlsEnabled: boolean
  /** The interface Traefik listens on: the difference between a name and a route. */
  bindAddress: string
}

export function emptyFacts(): DetectedFacts {
  return {
    publicIpv4: null,
    privateIpv4: [],
    tailscale: {
      installed: false,
      connected: false,
      ipv4: null,
      magicDns: null,
      httpsCerts: false,
      funnel: false,
      tagged: false,
    },
    cloudflare: {
      connectorAvailable: false,
      tunnelConfigured: false,
      tunnelConnected: false,
      accessConfigured: false,
      zone: null,
    },
    customDomain: null,
    resolvedDomain: 'localhost',
    tlsEnabled: false,
    bindAddress: '127.0.0.1',
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopback(address: string): boolean {
  return LOOPBACK.has(address)
}

function capability(
  id: CapabilityId,
  state: CapabilityState,
  detail: string | null = null,
  problem: string | null = null,
  hint: string | null = null,
): Capability {
  return { id, state, detail, problem, hint }
}

/**
 * Turn detected facts into the capability list.
 *
 * Every branch here is a statement about the host, never about intent. The
 * function is pure so the same evidence yields the same answer in the panel,
 * in `doctor`, and in the CLI.
 */
export function capabilitiesFrom(facts: DetectedFacts): Capability[] {
  const list: Capability[] = []

  // Always true, and worth stating: it is the one endpoint that needs nothing.
  list.push(capability('localhost', 'available', '127.0.0.1'))

  list.push(
    facts.privateIpv4.length > 0
      ? capability('lan', 'available', facts.privateIpv4.join(', '))
      : capability('lan', 'unavailable', null, 'no private non-loopback address on this host'),
  )

  const ts = facts.tailscale
  if (!ts.installed) {
    list.push(
      capability(
        'tailscale',
        'unavailable',
        null,
        'tailscale is not installed',
        'install Tailscale, then run: tailscale up',
      ),
    )
  } else if (!ts.connected) {
    list.push(
      capability(
        'tailscale',
        'configurable',
        null,
        'installed but not connected',
        'tailscale up   (Portta never authenticates it for you)',
      ),
    )
  } else {
    list.push(capability('tailscale', 'available', ts.ipv4))
  }

  list.push(
    ts.connected && ts.magicDns
      ? capability('tailscale-dns', 'available', ts.magicDns)
      : capability(
          'tailscale-dns',
          'unavailable',
          null,
          ts.connected ? 'MagicDNS is off for this tailnet' : 'tailscale is not connected',
        ),
  )

  // Serve over HTTPS and Funnel both need the tailnet to issue certificates,
  // which is an admin-console decision with a consequence worth stating: node
  // names become public in Certificate Transparency logs.
  list.push(
    ts.connected && ts.httpsCerts
      ? capability('tailscale-https', 'available', ts.magicDns)
      : capability(
          'tailscale-https',
          ts.connected ? 'configurable' : 'unavailable',
          null,
          'HTTPS certificates are not enabled for this tailnet',
          'Tailscale admin console -> DNS -> HTTPS Certificates. Node names then appear in public certificate transparency logs.',
        ),
  )

  list.push(
    ts.connected && ts.httpsCerts && ts.funnel
      ? capability('tailscale-funnel', 'available', ts.magicDns)
      : capability(
          'tailscale-funnel',
          ts.connected ? 'configurable' : 'unavailable',
          null,
          !ts.httpsCerts
            ? 'Funnel needs tailnet HTTPS certificates first'
            : 'the tailnet policy does not grant this node the funnel attribute',
          'add nodeAttrs "funnel" to the tailnet policy file. Funnel serves ports 443, 8443 and 10000 only, on the node name.',
        ),
  )

  list.push(
    facts.publicIpv4
      ? capability('public-ipv4', 'available', facts.publicIpv4)
      : capability(
          'public-ipv4',
          'unavailable',
          null,
          'no public address was detected; this host is probably behind NAT or CGNAT',
        ),
  )

  // The automatic domain follows the address, and reaches whoever the address
  // reaches: a public one from the internet, a tailnet one from the tailnet.
  list.push(
    facts.publicIpv4
      ? capability('auto-domain', 'available', `*.${facts.publicIpv4.replace(/\./g, '-')}.sslip.io`)
      : capability('auto-domain', 'unavailable', null, 'an automatic domain encodes an address, and none was detected'),
  )

  list.push(
    facts.customDomain
      ? capability('custom-domain', 'configured', `*.${facts.customDomain}`)
      : capability(
          'custom-domain',
          'configurable',
          null,
          'no wildcard domain is configured',
          'portta config set domain.mode custom',
        ),
  )

  const cf = facts.cloudflare
  if (!cf.connectorAvailable) {
    list.push(
      capability(
        'cloudflare-tunnel',
        'unavailable',
        null,
        'the cloudflared connector is not available on this host',
        'portta tunnel install',
      ),
    )
  } else if (!cf.tunnelConfigured) {
    list.push(
      capability(
        'cloudflare-tunnel',
        'configurable',
        null,
        'the connector is available but no tunnel is configured',
        'portta tunnel setup',
      ),
    )
  } else if (!cf.tunnelConnected) {
    list.push(
      capability(
        'cloudflare-tunnel',
        'error',
        cf.zone,
        'a tunnel is configured but the connector holds no connection to the edge',
        'portta tunnel status',
      ),
    )
  } else {
    list.push(capability('cloudflare-tunnel', 'active', cf.zone ? `*.${cf.zone}` : null))
  }

  list.push(
    cf.accessConfigured
      ? capability('cloudflare-access', 'configured')
      : capability(
          'cloudflare-access',
          cf.tunnelConfigured ? 'configurable' : 'unavailable',
          null,
          'no Access application protects a published hostname',
          'Cloudflare Zero Trust -> Access -> Applications. Portta never creates one for you.',
        ),
  )

  // HTTPS is available if anything in front of the service terminates it, and
  // the tunnel does so at Cloudflare's edge whether or not Traefik has a cert.
  const httpsDetail = facts.tlsEnabled
    ? 'Traefik terminates TLS'
    : cf.tunnelConnected
      ? 'terminated at the Cloudflare edge'
      : ts.httpsCerts
        ? 'available on the tailnet'
        : null
  list.push(
    httpsDetail
      ? capability('https', 'available', httpsDetail)
      : capability(
          'https',
          'unavailable',
          null,
          'nothing in front of these services terminates TLS',
          'portta tls init, or publish through a tunnel',
        ),
  )

  return list
}

export function capabilityById(list: Capability[], id: CapabilityId): Capability | null {
  return list.find((entry) => entry.id === id) ?? null
}

/** Whether a capability is in a state that can carry traffic today. */
export function isUsable(capability: Capability | null): boolean {
  return capability !== null && ['available', 'configured', 'active'].includes(capability.state)
}
