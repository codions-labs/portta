import { join } from 'node:path'
import type { Command } from 'commander'
import {
  AUTO_DOMAIN_PROVIDERS,
  allowsDisabledAuth,
  autoDomainFor,
  DOMAIN_MODES,
  exampleHostnames,
  isAutoDomainProvider,
  isDomainMode,
  isPanelAccess,
  PANEL_ACCESS_MODES,
  PANEL_ACCESS_WITHOUT_AUTH,
  patchEnvFile,
  prepareEnvFile,
} from 'portta-core'
import { composeArguments, gatewayContext } from '../context.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { syncForwardAuth } from './web.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

/**
 * The settings worth naming. `.env` stays the file of record and holds more
 * than this; these are the ones somebody changes on a running installation,
 * given a stable name so a script does not have to know which variable
 * implements them.
 */
interface Setting {
  key: string
  description: string
  /** Values this setting accepts, when the set is closed. */
  allowed?: readonly string[]
}

const SETTINGS: Record<string, Setting> = {
  'panel.access': { key: 'PORTTA_WEB_EXPOSE', description: 'how the panel is reached', allowed: PANEL_ACCESS_MODES },
  'panel.port': { key: 'PORTTA_WEB_PORT', description: 'host port the panel answers on' },
  'panel.auth': {
    key: 'PORTTA_AUTH_MODE',
    description: 'whether the panel asks who you are',
    allowed: ['disabled', 'required'],
  },
  'panel.host': {
    key: 'PORTTA_PANEL_ADVERTISED_HOST',
    description: 'hostname the panel answers on, and the address a human types',
  },
  'panel.readOnly': {
    key: 'PORTTA_WEB_READ_ONLY',
    description: 'refuse every mutating panel endpoint',
    allowed: ['true', 'false'],
  },
  'panel.image': { key: 'PORTTA_WEB_IMAGE', description: 'published panel image' },
  'gateway.profile': {
    key: 'PORTTA_PROFILE',
    description: 'local, remote-private or remote-public',
    allowed: ['local', 'remote-private', 'remote-public'],
  },
  'domain.mode': {
    key: 'PORTTA_DOMAIN_MODE',
    description: 'how project hostnames get their base domain',
    allowed: DOMAIN_MODES,
  },
  'domain.provider': {
    key: 'PORTTA_AUTO_DOMAIN_PROVIDER',
    description: 'wildcard DNS service used by the auto mode',
    allowed: AUTO_DOMAIN_PROVIDERS,
  },
  'domain.publicIp': { key: 'PORTTA_PUBLIC_IP', description: 'address the auto mode builds a hostname from' },
  'gateway.domain': { key: 'PORTTA_DOMAIN', description: 'base domain, when the mode is custom' },
  'gateway.bindAddress': { key: 'PORTTA_BIND_ADDRESS', description: 'interface Traefik publishes 80/443 on' },
  'public.domain': { key: 'PUBLIC_DOMAIN', description: 'public wildcard namespace' },
  'public.enabled': {
    key: 'PUBLIC_ENABLED',
    description: 'whether HTTP services may be published',
    allowed: ['true', 'false'],
  },
  'private.domain': { key: 'PRIVATE_DOMAIN', description: 'wildcard namespace served over the VPN' },
  'tls.enabled': { key: 'TLS_ENABLED', description: 'serve HTTPS', allowed: ['true', 'false'] },
  'tls.mode': { key: 'TLS_MODE', description: 'local certificate authority or ACME', allowed: ['local', 'acme'] },
  // Without these three, an ACME setup could be started from the CLI and not
  // finished with it: TLS_MODE=acme is refused until ACME_EMAIL is set.
  'acme.email': { key: 'ACME_EMAIL', description: 'contact address for the ACME account' },
  'acme.challenge': {
    key: 'ACME_CHALLENGE',
    description: 'one wildcard over DNS-01, or one per hostname over HTTP-01',
    allowed: ['dns', 'http'],
  },
  'acme.caServer': { key: 'ACME_CA_SERVER', description: 'ACME directory URL; point at staging while testing' },
  'dashboard.enabled': {
    key: 'PORTTA_DASHBOARD',
    description: "Traefik's own dashboard, on loopback",
    allowed: ['true', 'false'],
  },
  'tcp.enabled': { key: 'PORTTA_TCP', description: 'route datastores by hostname', allowed: ['true', 'false'] },
  'tailscale.enabled': {
    key: 'TAILSCALE_ENABLED',
    description: 'run the Tailscale sidecar',
    allowed: ['true', 'false'],
  },
}

/** Never printed, never returned, not even truncated. */
const SECRETS = new Set(['PORTTA_AUTH_SECRET', 'TS_AUTHKEY', 'CF_DNS_API_TOKEN'])

function setting(name: string): Setting {
  const found = SETTINGS[name]
  if (!found)
    throw new UsageError(
      `unknown setting: ${name}`,
      `portta config list shows the ${Object.keys(SETTINGS).length} settings this understands`,
    )
  return found
}

function write(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  patchEnvFile(path, values)
}

export async function configList(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const rows = Object.entries(SETTINGS).map(([name, item]) => ({
    setting: name,
    variable: item.key,
    value: SECRETS.has(item.key) ? (context.env[item.key] ? '<set>' : '') : (context.env[item.key] ?? ''),
    description: item.description,
  }))
  const output = new Output(global)
  if (output.json) {
    output.data({ root: context.root, settings: rows })
    return
  }
  for (const row of rows) output.line(`${row.setting.padEnd(22)} ${String(row.value).padEnd(24)} ${row.description}`)
}

export async function configGet(name: string, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const item = setting(name)
  if (SECRETS.has(item.key))
    throw new RefusedError(`${name} is a secret and is never printed`, 'portta doctor reports whether it is set')
  const value = context.env[item.key] ?? ''
  const output = new Output(global)
  if (output.json) output.data({ setting: name, variable: item.key, value })
  else output.line(value)
}

/**
 * Applying a setting means recreating the gateway, because most of them are
 * baked into Traefik's static configuration or into which overlays Compose is
 * given. Doing it here is the difference between a setting that took effect
 * and one that will take effect the next time somebody remembers.
 */
async function apply(
  root: string,
  profile: string | undefined,
  values: Record<string, string>,
  output: Output,
): Promise<void> {
  // The values just written win over anything inherited, for the same reason
  // `web up` needs it: the environment normally beats the file.
  const context = gatewayContext({ root, profile, overrides: values })
  output.progress('recreating gateway components')
  await runProcess(
    'docker',
    ['compose', ...composeArguments(context), 'up', '-d', '--remove-orphans', '--wait', '--wait-timeout', '180'],
    { cwd: context.root, env: context.env, stdio: 'inherit' },
  )
}

/**
 * This host's address as the internet sees it. One outbound request, made only
 * when somebody deliberately asks for the auto mode — resolving a hostname
 * reads the stored value and never reaches the network.
 */
async function detectPublicIp(): Promise<string | null> {
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) continue
      const address = (await response.text()).trim()
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) return address
    } catch {
      /* try the next one */
    }
  }
  return null
}

/**
 * The base domain is a name, and nothing here changes who can reach a service.
 * Switching the mode re-labels every project at once, because hostnames are
 * derived rather than persisted: no project is touched and nothing migrates.
 */
async function setDomainMode(root: string, value: string, output: Output): Promise<Record<string, string>> {
  if (!isDomainMode(value)) throw new UsageError(`domain.mode must be one of: ${DOMAIN_MODES.join(', ')}`)
  const context = gatewayContext({ root })
  const values: Record<string, string> = { PORTTA_DOMAIN_MODE: value }

  if (value === 'auto') {
    // Re-detect rather than trust a stored address: a VPS can be rebuilt, and a
    // hostname built from yesterday's address resolves somewhere else entirely.
    output.progress("detecting this host's public address")
    const detected = (await detectPublicIp()) ?? context.env.PORTTA_PUBLIC_IP ?? null
    if (!detected) {
      throw new PreconditionError(
        'no public address could be detected for this host',
        'set it yourself: portta config set domain.publicIp <address>',
      )
    }
    values.PORTTA_PUBLIC_IP = detected
    const provider = context.env.PORTTA_AUTO_DOMAIN_PROVIDER
    const domain = autoDomainFor(detected, provider && isAutoDomainProvider(provider) ? provider : 'sslip.io')
    if (!domain) throw new PreconditionError(`${detected} is not an IPv4 address`)
    values.PORTTA_DOMAIN = domain
    output.progress(`projects will answer on *.${domain}`)
    for (const example of exampleHostnames(domain)) output.progress(`  ${example}`)
    if (context.config.bindAddress === '127.0.0.1') {
      output.warning('Traefik still listens on 127.0.0.1, so these names resolve here but nothing answers from outside')
      output.hint('portta public enable   exposes the HTTP services that opted in')
    }
  }

  if (value === 'custom') {
    const configured = context.env.PORTTA_DOMAIN
    if (!configured || configured === 'localhost') {
      throw new PreconditionError(
        'domain mode custom needs a domain',
        'set it first: portta config set gateway.domain dev.example.com',
      )
    }
    output.hint(`*.${configured} must resolve to this host; portta dns check confirms it`)
  }

  if (value === 'local') {
    values.PORTTA_DOMAIN = 'localhost'
    output.hint('projects will answer on *.localhost, which only resolves on this machine')
  }
  return values
}

async function tailscaleAddress(): Promise<string | null> {
  const result = await runProcess('tailscale', ['ip', '-4'], { reject: false })
  const address = result.stdout.split('\n')[0]?.trim() ?? ''
  return result.exitCode === 0 && address ? address : null
}

/**
 * Panel access is the one setting with consequences beyond its own variable:
 * it decides which interface the panel is published on, whether a credential
 * is mandatory, and which overlay owns the port. Setting it by hand in .env
 * gets one of those three wrong, so it is resolved here instead.
 */
async function setPanelAccess(root: string, value: string, output: Output): Promise<Record<string, string>> {
  if (!isPanelAccess(value)) throw new UsageError(`panel.access must be one of: ${PANEL_ACCESS_MODES.join(', ')}`)
  const context = gatewayContext({ root })
  const values: Record<string, string> = { PORTTA_WEB_EXPOSE: value, PORTTA_WEB: 'true' }
  const protectedPanel = context.env.PORTTA_AUTH_MODE === 'required'

  // The same rule `resolveSecurityMode` enforces at boot, applied here so it
  // fails in the terminal the operator is looking at rather than in a container
  // log they have to go and find.
  if (!allowsDisabledAuth(value) && !protectedPanel) {
    throw new RefusedError(
      `panel access '${value}' answers whoever finds the address while the panel answers everybody as the local operator`,
      'portta config set panel.auth required   then open /setup to create the owner',
    )
  }
  if (allowsDisabledAuth(value) && !protectedPanel && value !== 'local') {
    output.warning(
      `anybody who reaches the panel over the ${value === 'tailscale' ? 'tailnet' : 'VPN'} is the local operator`,
    )
    output.hint('portta config set panel.auth required   asks who they are instead')
  }
  if (value === 'vpn' && context.config.profile === 'remote-public') {
    throw new RefusedError(
      'the panel must not be routed on the tailnet hostname while Traefik binds every interface',
      "portta config set panel.access domain   routes it on the gateway's own domain",
    )
  }

  switch (value) {
    case 'public':
      if (context.config.profile !== 'local' && context.config.tailscaleEnabled) {
        throw new RefusedError(
          'panel access `public` cannot be combined with the Tailscale attachment',
          'use panel.access tailscale, or set tailscale.enabled false',
        )
      }
      values.PORTTA_WEB_BIND_ADDRESS = '0.0.0.0'
      output.warning(
        'the panel will be reachable from every network this host is on; authentication is enforced by the proxy',
      )
      break
    case 'domain': {
      // The router matches Host(...), so a hostname is the whole precondition,
      // and TLS is what makes routing the panel an improvement on `public`
      // rather than the same exposure without the separate entrypoint.
      const advertised = context.env.PORTTA_PANEL_ADVERTISED_HOST ?? ''
      if (!advertised || advertised === 'localhost' || /^[0-9.]+$/.test(advertised)) {
        throw new RefusedError(
          `panel access 'domain' needs a hostname to route on, and this host advertises ${advertised || 'nothing'}`,
          'portta config set panel.host portta.example.com',
        )
      }
      if (!context.config.tlsEnabled) {
        throw new RefusedError(
          'a panel routed on the domain would carry its credential in clear text',
          'enable TLS first: portta config set tls.enabled true',
        )
      }
      // The panel's front door is the router now; a published host port beside
      // it would be a second way in that the middleware never sees.
      values.PORTTA_WEB_BIND_ADDRESS = '127.0.0.1'
      output.warning(
        `the panel will answer on https://${advertised}, behind the same login page a protected project gets`,
      )
      break
    }
    case 'tailscale': {
      const address = await tailscaleAddress()
      if (!address)
        throw new PreconditionError(
          'this host has no Tailscale address',
          'connect it yourself with `tailscale up`, then set this again',
        )
      values.PORTTA_WEB_BIND_ADDRESS = address
      values.PORTTA_PANEL_ADVERTISED_HOST = address
      break
    }
    case 'local':
      values.PORTTA_WEB_BIND_ADDRESS = '127.0.0.1'
      values.PORTTA_PANEL_ADVERTISED_HOST = '127.0.0.1'
      break
    case 'vpn':
      values.PORTTA_WEB_BIND_ADDRESS = '127.0.0.1'
      break
  }

  return values
}

/**
 * Turning the login off is the other half of the same rule as panel access, and
 * the two are set in either order. Deciding it here means the refusal arrives
 * in the terminal, with the command that fixes it, instead of at the next boot.
 */
function setPanelAuth(root: string, value: string, output: Output): Record<string, string> {
  const context = gatewayContext({ root })
  if (value === 'required') {
    if (!context.env.PORTTA_AUTH_SECRET) output.hint('portta web up generates the session secret; nothing prints it')
    return { PORTTA_AUTH_MODE: 'required' }
  }

  const access = context.env.PORTTA_WEB_EXPOSE || 'local'
  if (!isPanelAccess(access) || !allowsDisabledAuth(access)) {
    throw new RefusedError(
      `the panel is reached over '${access}', which answers whoever finds the address`,
      `portta config set panel.access <${PANEL_ACCESS_WITHOUT_AUTH.join('|')}>   then set panel.auth disabled`,
    )
  }
  const bind = context.env.PORTTA_WEB_BIND_ADDRESS || '127.0.0.1'
  const loopback = bind === '127.0.0.1' || bind === 'localhost' || bind === '::1' || bind === '[::1]'
  if (access === 'local' && !loopback && context.env.PORTTA_AUTH_ALLOW_LAN !== 'true') {
    throw new RefusedError(
      `the panel is bound to ${bind}, so turning the login off offers it to every device on this network`,
      'set PORTTA_AUTH_ALLOW_LAN=true in .env to accept that, or portta config set panel.access local',
    )
  }
  if (access !== 'local') {
    output.warning(
      `anybody who reaches the panel over the ${access === 'tailscale' ? 'tailnet' : 'VPN'} is now the local operator`,
    )
  }
  return { PORTTA_AUTH_MODE: 'disabled' }
}

export async function configSet(
  name: string,
  value: string,
  options: { apply?: boolean },
  command: Command,
): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const item = setting(name)
  if (SECRETS.has(item.key))
    throw new RefusedError(
      `${name} is a secret and is not set this way`,
      'edit .env; portta web up generates PORTTA_AUTH_SECRET when it is empty',
    )
  if (item.allowed && !item.allowed.includes(value))
    throw new UsageError(`${name} must be one of: ${item.allowed.join(', ')}`)

  let values: Record<string, string>
  if (name === 'panel.access') values = await setPanelAccess(context.root, value, output)
  else if (name === 'panel.auth') values = setPanelAuth(context.root, value, output)
  else if (name === 'domain.mode') values = await setDomainMode(context.root, value, output)
  else values = { [item.key]: value }

  // A custom base only takes effect through the mode, so setting one without
  // switching would write a value nothing reads.
  if (name === 'gateway.domain' && value && context.config.domainMode !== 'custom') {
    output.hint('domain.mode is not custom, so this value is not in use yet')
    output.hint('portta config set domain.mode custom   applies it')
  }

  write(context.root, values)
  if (name === 'panel.access') syncForwardAuth(context.root)
  output.progress(`${name} = ${value}`)

  if (options.apply === false) {
    output.hint('nothing was restarted: run portta up to apply it')
  } else {
    await apply(context.root, global.profile, values, output)
  }

  if (output.json) output.data({ setting: name, value, applied: options.apply !== false, changed: values })
}

/** Prepare configuration without starting or touching Docker resources. */
export function configPrepare(command: Command): void {
  const context = gatewayContext({ profile: globals(command).profile })
  prepareEnvFile(join(context.root, '.env'))
  new Output(globals(command)).progress('configuration prepared from .env.example; existing values preserved')
}
