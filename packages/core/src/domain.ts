/**
 * Where a project's hostname comes from.
 *
 * Portta derives every project hostname as `<project>-<service>.<base>`, and
 * until now `<base>` was `localhost` unless the gateway ran a remote profile.
 * That is right on a workstation and wrong on a VPS: `demo-web.localhost`
 * resolves to the loopback of whoever typed it, so a panel reached over the
 * internet advertised URLs nobody could open.
 *
 * The base is now a mode rather than a value:
 *
 *   local    localhost, for a machine you are sitting at
 *   auto     <ip-with-dashes>.sslip.io, for a host with a public address and
 *            no domain of its own
 *   custom   whatever the operator configured
 *
 * Everything downstream keeps reading one resolved `PORTTA_DOMAIN`: Traefik's
 * default rule, `portta urls`, and the panel. Hostnames are derived and never
 * persisted, so changing the mode re-labels every project at once, with no
 * project touched and nothing to migrate.
 *
 * See docs/development/adr/0022-project-domain-modes.md.
 */

import { hostLabel } from './hostname.ts'

export const DOMAIN_MODES = ['local', 'auto', 'custom'] as const
export type DomainMode = (typeof DOMAIN_MODES)[number]

export function isDomainMode(value: string): value is DomainMode {
  return (DOMAIN_MODES as readonly string[]).includes(value)
}

/**
 * The wildcard DNS services that answer for any name embedding an IP address.
 * Both resolve `<anything>.<ip-with-dashes>.<provider>` to that address, so a
 * derived hostname needs no DNS record, no registration and no account.
 */
export const AUTO_DOMAIN_PROVIDERS = ['sslip.io', 'nip.io'] as const
export type AutoDomainProvider = (typeof AUTO_DOMAIN_PROVIDERS)[number]

export function isAutoDomainProvider(value: string): value is AutoDomainProvider {
  return (AUTO_DOMAIN_PROVIDERS as readonly string[]).includes(value)
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isIpv4(value: string): boolean {
  return IPV4.test(value)
}

/**
 * Both providers accept the dotted form (`1.2.3.4.sslip.io`) and the dashed one
 * (`1-2-3-4.sslip.io`). The dashed form is used here because it keeps the
 * address to a single DNS label, which leaves `<project>-<service>` as its own
 * label and makes the whole name legal for a TLS certificate covering
 * `*.1-2-3-4.sslip.io`.
 */
export function autoDomainFor(ip: string, provider: AutoDomainProvider = 'sslip.io'): string | null {
  if (!isIpv4(ip)) return null
  return `${ip.replace(/\./g, '-')}.${provider}`
}

/** The address an auto domain encodes, or null when it encodes none. */
export function ipFromAutoDomain(domain: string): string | null {
  for (const provider of AUTO_DOMAIN_PROVIDERS) {
    if (!domain.toLowerCase().endsWith(`.${provider}`)) continue
    const label =
      domain
        .slice(0, -(provider.length + 1))
        .split('.')
        .pop() ?? ''
    const dotted = label.replace(/-/g, '.')
    if (isIpv4(dotted)) return dotted
    if (isIpv4(label)) return label
  }
  return null
}

export interface DomainResolution {
  mode: DomainMode
  /** The base every project hostname is built on. */
  domain: string
  /** Set when the mode asked for something the configuration cannot supply. */
  problem: string | null
}

/**
 * Resolve the base domain from the mode and what the mode needs.
 *
 * A mode that cannot be honoured falls back to `localhost` and says why, rather
 * than failing: an unreachable hostname is a nuisance, and a gateway that
 * refuses to start over one is worse.
 */
export function resolveDomain(options: {
  mode: string
  publicIp?: string | null
  provider?: string | null
  configured?: string | null
}): DomainResolution {
  const mode: DomainMode = isDomainMode(options.mode) ? options.mode : 'local'
  const configured = options.configured?.trim() || null

  if (mode === 'custom') {
    if (!configured) return { mode, domain: 'localhost', problem: 'domain mode is custom and no domain is set' }
    return { mode, domain: configured, problem: null }
  }

  if (mode === 'auto') {
    const provider = options.provider && isAutoDomainProvider(options.provider) ? options.provider : 'sslip.io'
    const ip = options.publicIp?.trim() || null
    if (!ip)
      return { mode, domain: 'localhost', problem: 'domain mode is auto and no public address has been detected' }
    const domain = autoDomainFor(ip, provider)
    if (!domain) return { mode, domain: 'localhost', problem: `domain mode is auto and ${ip} is not an IPv4 address` }
    return { mode, domain, problem: null }
  }

  return { mode: 'local', domain: 'localhost', problem: null }
}

/** What a project's hostname will look like, for a preview the operator reads. */
export function exampleHostnames(domain: string, services = ['web', 'api'], project = 'loja'): string[] {
  return services.map((service) => `${hostLabel({ project, service })}.${domain}`)
}
