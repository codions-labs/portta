// The settings the panel is willing to touch.
//
// This catalogue is the whole surface: a key that is not listed here cannot be
// read through the API and cannot be written by it, whatever a request asks
// for. Secrets are listed so the UI can say whether they are set, and their
// values never leave the host.

import type { ConfigField } from 'portta-contracts'
import { normalizeProjectsHome, ProjectsHomeError } from 'portta-core'

export interface FieldSpec {
  key: string
  group: string
  label: string
  help: string
  kind: ConfigField['kind']
  choices?: string[]
  secret?: boolean
  /** Canonical default when the key is absent from .env. */
  defaultValue?: string
  /** How an unset value was obtained, when it is not a catalogue default. */
  valueSource?: 'detected'
  /** Takes effect only once the gateway containers are recreated. */
  restartRequired: boolean
  validate?: (value: string) => string | null
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/

function domain(value: string): string | null {
  if (value === '') return null
  return HOSTNAME.test(value) ? null : 'must be a hostname, for example dev.example.com'
}

function dnsLabel(value: string): string | null {
  if (value === '') return null
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(value) ? null : 'must be a single hostname label, for example portta'
}

function port(value: string): string | null {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 65535) return 'must be a port between 1 and 65535'
  return null
}

function publicIp(value: string): string | null {
  if (value === '') return null
  return IPV4.test(value) ? null : 'must be an IPv4 address, for example 203.0.113.10'
}

function bindAddress(value: string): string | null {
  if (value === '') return null
  if (value === 'localhost' || value === '::1') return null
  return IPV4.test(value) ? null : 'must be an IPv4 address'
}

/**
 * An origin, not a URL with a path.
 *
 * The panel URL becomes Better Auth's `baseURL` and the origin a write must
 * come from, so a trailing path or a credential in it would silently widen or
 * break both.
 */
function panelUrl(value: string): string | null {
  if (value === '') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be a URL, such as https://panel.example.com'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must be http or https'
  if (url.username || url.password) return 'must not carry a credential'
  if (url.pathname !== '/' || url.search || url.hash) return 'must be an origin, with no path'
  return null
}

function trustedOriginList(value: string): string | null {
  if (value === '') return null
  for (const entry of value.split(',')) {
    const refusal = panelUrl(entry.trim())
    if (refusal) return `${entry.trim()}: ${refusal}`
  }
  return null
}

function email(value: string): string | null {
  if (value === '') return null
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? null : 'must be an email address'
}

/**
 * The directory `docker/compose/features/web.yaml` mounts the key from. It is
 * the whole constraint on this setting: a path outside it names a file that is
 * not in the container at all, so the panel could never read it.
 */
function url(value: string): string | null {
  if (value === '') return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? null : 'must be an https URL'
  } catch {
    return 'must be a URL'
  }
}

/**
 * Lexical only. The panel never opens Projects Home; the host collector does.
 * An empty value keeps the installer / CLI default.
 */
function projectsHome(value: string): string | null {
  if (value === '') return null
  try {
    normalizeProjectsHome(value)
    return null
  } catch (error) {
    return error instanceof ProjectsHomeError ? error.message : 'must be an absolute directory'
  }
}

export const FIELDS: FieldSpec[] = [
  {
    key: 'PORTTA_PROJECTS_HOME',
    group: 'Projects',
    label: 'Projects Home',
    help:
      'The one directory this installation manages Projects in. Changing it changes the reference; ' +
      'files are not moved. Existing environments outside this path stay visible as unmanaged. ' +
      'See docs/development/adr/0031-projects-home-and-project.md.',
    kind: 'string',
    restartRequired: false,
    validate: projectsHome,
  },
  {
    key: 'PORTTA_DOMAIN_MODE',
    group: 'Project domain',
    label: 'How addresses are built',
    help:
      'The base every project hostname is built on. This machine uses localhost. Automatic builds a name ' +
      'from this host address, with no DNS record. Your own domain needs a wildcard pointing here. ' +
      'See docs/product/concepts/addresses-and-access.md#project-addresses.',
    kind: 'choice',
    choices: ['local', 'auto', 'custom'],
    defaultValue: 'local',
    restartRequired: true,
  },
  {
    key: 'PORTTA_PUBLIC_IP',
    group: 'Project domain',
    label: 'Host address',
    help: 'The IPv4 address automatic mode embeds in the hostname. Detected during installation.',
    kind: 'string',
    valueSource: 'detected',
    restartRequired: true,
    validate: publicIp,
  },
  {
    key: 'PORTTA_AUTO_DOMAIN_PROVIDER',
    group: 'Project domain',
    label: 'Automatic DNS service',
    help: 'sslip.io and nip.io both resolve any name that embeds this host address, so neither needs a record or an account.',
    kind: 'choice',
    choices: ['sslip.io', 'nip.io'],
    defaultValue: 'sslip.io',
    restartRequired: true,
  },
  {
    key: 'PORTTA_DOMAIN',
    group: 'Project domain',
    label: 'Your domain',
    help: 'Used when addresses are built on a domain you own. A wildcard *.<domain> must resolve to this host. See docs/product/concepts/addresses-and-access.md#custom-domain.',
    kind: 'string',
    defaultValue: 'localhost',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'PORTTA_PROFILE',
    group: 'Project access',
    label: 'Gateway profile',
    help: 'Where Traefik listens: this machine, a private network, or the internet. Independent of the panel. See docs/product/concepts/addresses-and-access.md#the-three-decisions.',
    kind: 'choice',
    choices: ['local', 'remote-private', 'remote-public'],
    defaultValue: 'local',
    restartRequired: true,
  },
  {
    key: 'PORTTA_BIND_ADDRESS',
    group: 'Project access',
    label: 'Listen on',
    help: 'Interface Traefik publishes on. 127.0.0.1 keeps project traffic off the local network.',
    kind: 'string',
    defaultValue: '127.0.0.1',
    restartRequired: true,
    validate: bindAddress,
  },
  {
    key: 'PORTTA_HTTP_PORT',
    group: 'Project access',
    label: 'HTTP port',
    help: 'Host port for plain HTTP.',
    kind: 'number',
    defaultValue: '80',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_HTTPS_PORT',
    group: 'Project access',
    label: 'HTTPS port',
    help: 'Host port for HTTPS.',
    kind: 'number',
    defaultValue: '443',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_LOG_LEVEL',
    group: 'Project access',
    label: 'Log level',
    help: 'Log level for the gateway components.',
    kind: 'choice',
    choices: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    defaultValue: 'INFO',
    restartRequired: true,
  },
  {
    key: 'PORTTA_ACCESS_LOG',
    group: 'Project access',
    label: 'Traefik access log',
    help: 'Useful while debugging routing, noisy otherwise.',
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'PUBLIC_ENABLED',
    group: 'Project access',
    label: 'Internet access',
    help:
      'Lets the internet reach Traefik on ports 80 and 443. It does not change how projects are named, ' +
      'and it does not publish the panel. Only services that opt in are routed. ' +
      'See docs/product/concepts/addresses-and-access.md#public-access.',
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'PUBLIC_DOMAIN',
    group: 'Project access',
    label: 'Public project domain',
    help: 'Domain used to publish opted-in projects on the internet, for example dev.example.com. A wildcard must point at this host.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'TAILSCALE_ENABLED',
    group: 'Project access',
    label: 'Tailscale',
    help: 'Run Traefik inside the Tailscale network namespace so projects are reachable on the tailnet, not the public NIC. See docs/product/concepts/addresses-and-access.md#vpn.',
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'TAILSCALE_HOSTNAME',
    group: 'Project access',
    label: 'Tailscale hostname',
    help: 'Name this node takes on the tailnet.',
    kind: 'string',
    defaultValue: 'portta',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'TS_AUTHKEY',
    group: 'Project access',
    label: 'Tailscale auth key',
    help: 'Prefer an ephemeral, tagged, pre-authorised key. Never leaves the host.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'PRIVATE_DOMAIN',
    group: 'Project access',
    label: 'Private domain',
    help: 'Optional wildcard served only over the VPN. Leave empty to reuse the project domain base.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'TLS_ENABLED',
    group: 'TLS',
    label: 'HTTPS',
    help: 'Issue certificates for project hostnames. Off, only the HTTP entrypoint serves routes. See docs/product/concepts/addresses-and-access.md#tls.',
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'TLS_MODE',
    group: 'TLS',
    label: 'Certificate source',
    help: 'This machine uses a local CA. Let’s Encrypt uses ACME.',
    kind: 'choice',
    choices: ['local', 'acme'],
    defaultValue: 'local',
    restartRequired: true,
  },
  {
    key: 'ACME_EMAIL',
    group: 'TLS',
    label: 'Let’s Encrypt contact',
    help: 'Required when certificates come from Let’s Encrypt.',
    kind: 'string',
    restartRequired: true,
    validate: email,
  },
  {
    key: 'ACME_CHALLENGE',
    group: 'TLS',
    label: 'How to prove the domain',
    help: 'DNS issues one wildcard and needs a provider credential. HTTP issues one certificate per hostname and needs port 80 reachable from the internet.',
    kind: 'choice',
    choices: ['dns', 'http'],
    defaultValue: 'dns',
    restartRequired: true,
  },
  {
    key: 'ACME_CA_SERVER',
    group: 'TLS',
    label: 'ACME directory',
    help: 'Point at the staging endpoint while testing to avoid rate limits.',
    kind: 'string',
    defaultValue: 'https://acme-v02.api.letsencrypt.org/directory',
    restartRequired: true,
    validate: url,
  },
  {
    key: 'ACME_DNS_PROVIDER',
    group: 'TLS',
    label: 'DNS-01 provider',
    help: 'Provider name as understood by Traefik/lego. Ignored when the challenge is HTTP. See docs/product/concepts/addresses-and-access.md#dns.',
    kind: 'string',
    defaultValue: 'cloudflare',
    restartRequired: true,
  },
  {
    key: 'CLOUDFLARE_ENABLED',
    group: 'DNS',
    label: 'Cloudflare DNS',
    help: 'Create the wildcard record and answer DNS-01 challenges through Cloudflare. This does not choose the project domain. See docs/product/concepts/addresses-and-access.md#dns.',
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'CLOUDFLARE_ZONE',
    group: 'DNS',
    label: 'Cloudflare zone',
    help: 'The zone the wildcard record lives in.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'CF_DNS_API_TOKEN',
    group: 'DNS',
    label: 'Cloudflare API token',
    help: 'A scoped token (Zone:DNS:Edit), never the global API key.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'PORTTA_WEB_PORT',
    group: 'Panel',
    label: 'Port',
    help: 'Host port used to publish the panel. This is not the address you type in a browser when the panel is reached by a hostname.',
    kind: 'number',
    defaultValue: '8081',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_WEB_BIND_ADDRESS',
    group: 'Panel',
    label: 'Bind',
    help: 'Host interface used to publish the panel. Keep 127.0.0.1 unless you choose a tailnet address or explicitly enable its public entrypoint.',
    kind: 'string',
    defaultValue: '127.0.0.1',
    restartRequired: true,
    validate: bindAddress,
  },
  {
    key: 'PORTTA_WEB_EXPOSE',
    group: 'Panel',
    label: 'How the panel is reached',
    help:
      'This machine is loopback only. The other modes put the panel beyond this host and require sign-in. ' +
      'None of them publishes your projects. See docs/product/concepts/addresses-and-access.md#the-panel.',
    kind: 'choice',
    choices: ['local', 'tailscale', 'public', 'vpn', 'domain'],
    defaultValue: 'local',
    restartRequired: true,
  },
  {
    key: 'PORTTA_WEB_HOST',
    group: 'Panel',
    label: 'Panel subdomain',
    help: 'The label in front of the project domain when the panel is reached as a subdomain.',
    kind: 'string',
    defaultValue: 'portta-web',
    restartRequired: true,
    validate: dnsLabel,
  },
  {
    key: 'PORTTA_PANEL_ADVERTISED_HOST',
    group: 'Panel',
    label: 'Panel hostname',
    help: 'The hostname Traefik routes to the panel when it is reached by a domain.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'PORTTA_WEB_READ_ONLY',
    group: 'Panel',
    label: 'Read-only',
    help: 'Refuse every mutating endpoint. The default whenever the panel is routed beyond this machine.',
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'PORTTA_AUTH_MODE',
    group: 'Panel',
    label: 'Authentication',
    help: 'Required makes the panel ask who you are. Disabled makes every request the local operator, and is only allowed on this machine.',
    kind: 'choice',
    choices: ['disabled', 'required'],
    defaultValue: 'disabled',
    restartRequired: true,
  },
  {
    key: 'PORTTA_AUTH_SECRET',
    group: 'Panel',
    label: 'Session signing secret',
    help: 'What sessions and tokens are signed with. Generated during bootstrap; rotating it signs everybody out.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'PORTTA_PANEL_URL',
    group: 'Panel',
    label: 'Panel URL',
    help: 'The origin a browser reaches the panel on. It decides where sign-in redirects to and whether the session cookie may be Secure.',
    kind: 'string',
    restartRequired: true,
    validate: panelUrl,
  },
  {
    key: 'PORTTA_PANEL_TRUSTED_ORIGINS',
    group: 'Panel',
    label: 'Extra trusted origins',
    help: 'Other origins a browser may sign in from, comma-separated. Loopback and the panel URL are always trusted.',
    kind: 'string',
    restartRequired: true,
    validate: trustedOriginList,
  },
  {
    key: 'PORTTA_RUNTIME_DOCS',
    group: 'Panel',
    label: 'Documentation',
    help: "Serve the project's documentation at /docs, from this image. Static text with no host information in it, so a routed panel may serve it.",
    kind: 'boolean',
    defaultValue: 'true',
    restartRequired: true,
  },
  {
    key: 'PORTTA_RUNTIME_API_DOCS',
    group: 'Panel',
    label: 'API reference',
    help: 'Serve the API reference and its console at /docs/api. It issues real requests against this panel, so empty uses the safe default: on for this machine, off when routed.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PORTTA_DASHBOARD',
    group: 'Traefik',
    label: 'Traefik dashboard',
    help: "Traefik's own dashboard. It has no login and stays on loopback under the normal host attachment. A Tailscale attachment can also make it reachable on the tailnet. See docs/product/concepts/addresses-and-access.md#traefik.",
    kind: 'boolean',
    defaultValue: 'false',
    restartRequired: true,
  },
  {
    key: 'PORTTA_DASHBOARD_PORT',
    group: 'Traefik',
    label: 'Dashboard port',
    help: 'Host port for the Traefik dashboard.',
    kind: 'number',
    defaultValue: '8080',
    restartRequired: true,
    validate: port,
  },
]

export const FIELDS_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]))

export class ValidationError extends Error {
  key: string
  constructor(key: string, message: string) {
    super(`${key}: ${message}`)
    this.name = 'ValidationError'
    this.key = key
  }
}

export function validateValue(key: string, value: string): void {
  const field = FIELDS_BY_KEY.get(key)
  if (!field) throw new ValidationError(key, 'is not a setting the panel manages')
  if (field.kind === 'boolean' && !['true', 'false'].includes(value)) {
    throw new ValidationError(key, 'must be true or false')
  }
  if (field.kind === 'choice' && !(field.choices ?? []).includes(value)) {
    throw new ValidationError(key, `must be one of ${(field.choices ?? []).join(', ')}`)
  }
  const problem = field.validate?.(value)
  if (problem) throw new ValidationError(key, problem)
}

/**
 * Refuses combinations the CLI would refuse at startup, so a save cannot leave
 * the gateway unable to come back up.
 */
export function validateCombination(values: Map<string, string>): void {
  const get = (key: string) => values.get(key) ?? ''
  const truthy = (key: string) => ['1', 'true', 'yes', 'on', 'enabled'].includes(get(key).toLowerCase())

  const profile = get('PORTTA_PROFILE') || 'local'
  const domainMode = get('PORTTA_DOMAIN_MODE') || 'local'
  const projectDomainCanBePublic =
    (domainMode === 'auto' && get('PORTTA_PUBLIC_IP') !== '') ||
    (domainMode === 'custom' && get('PORTTA_DOMAIN') !== '' && get('PORTTA_DOMAIN') !== 'localhost')
  if (profile === 'remote-public' && get('PUBLIC_DOMAIN') === '' && !projectDomainCanBePublic) {
    throw new ValidationError('PUBLIC_DOMAIN', 'is required by the remote-public profile')
  }
  if (profile === 'remote-private' && !truthy('TAILSCALE_ENABLED') && get('PORTTA_BIND_ADDRESS') === '0.0.0.0') {
    throw new ValidationError('PORTTA_BIND_ADDRESS', 'the remote-private profile must not bind 0.0.0.0')
  }
  if (truthy('TLS_ENABLED') && get('TLS_MODE') === 'acme' && get('ACME_EMAIL') === '') {
    throw new ValidationError('ACME_EMAIL', 'is required when TLS_MODE is acme')
  }
  if (truthy('TAILSCALE_ENABLED') && get('TS_AUTHKEY') === '' && get('TAILSCALE_HOSTNAME') === '') {
    throw new ValidationError('TAILSCALE_HOSTNAME', 'is required when Tailscale is enabled')
  }
  // A mode that cannot be honoured resolves to localhost, which is the failure
  // this whole setting exists to avoid. Refuse it here, where the operator is
  // looking, rather than letting it fall back quietly.
  if (domainMode === 'auto' && get('PORTTA_PUBLIC_IP') === '') {
    throw new ValidationError('PORTTA_PUBLIC_IP', 'is required by the auto domain mode')
  }
  if (domainMode === 'custom' && (get('PORTTA_DOMAIN') === '' || get('PORTTA_DOMAIN') === 'localhost')) {
    throw new ValidationError('PORTTA_DOMAIN', 'the custom domain mode needs a domain of its own')
  }

  // A routed panel can stop containers and, since ADR 0010, says what is being
  // worked on. The tailnet is a good boundary and a poor last one.
  if (['tailscale', 'vpn', 'public', 'domain'].includes(get('PORTTA_WEB_EXPOSE'))) {
    if (get('PORTTA_AUTH_MODE') !== 'required') {
      throw new ValidationError('PORTTA_AUTH_MODE', 'must be required while the panel is reachable beyond this host')
    }
    if (get('PORTTA_AUTH_SECRET') === '') {
      throw new ValidationError(
        'PORTTA_AUTH_SECRET',
        'a panel that signs people in needs a signing secret: run portta bootstrap',
      )
    }
  }

  if (
    get('PORTTA_WEB_EXPOSE') === 'tailscale' &&
    ['127.0.0.1', 'localhost', '::1', ''].includes(get('PORTTA_WEB_BIND_ADDRESS'))
  ) {
    throw new ValidationError(
      'PORTTA_WEB_BIND_ADDRESS',
      "panel access over Tailscale needs this node's tailnet address",
    )
  }

  if (get('PORTTA_WEB_EXPOSE') === 'domain' && !truthy('TLS_ENABLED')) {
    throw new ValidationError('TLS_ENABLED', 'a panel routed on a domain requires TLS')
  }

  if (profile === 'remote-public' && get('PORTTA_WEB_EXPOSE') === 'vpn') {
    throw new ValidationError(
      'PORTTA_WEB_EXPOSE',
      'the panel must not use a private routed hostname while Traefik listens publicly',
    )
  }

  if (get('PORTTA_WEB_EXPOSE') === 'public' && profile !== 'local' && truthy('TAILSCALE_ENABLED')) {
    throw new ValidationError(
      'PORTTA_WEB_EXPOSE',
      'public panel access is not available while Traefik uses the Tailscale network namespace',
    )
  }

  if (get('PORTTA_WEB_BIND_ADDRESS') === '0.0.0.0' && get('PORTTA_WEB_EXPOSE') !== 'public') {
    throw new ValidationError(
      'PORTTA_WEB_BIND_ADDRESS',
      'the panel is not published on every interface; reach it over the VPN instead',
    )
  }
}
