import { isIP } from 'node:net'
import { join } from 'node:path'
import type { Command } from 'commander'
import { parseEnv, patchEnvFile, readEnvFile, ungatedContainers } from 'portta-core'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'

export interface PublicInitOptions {
  domain?: string
  email?: string
  panelHost?: string
  ip?: string
  cloudflareTokenStdin?: boolean
  dryRun?: boolean
}

/** Replaceable in tests; the real one reads the first line of standard input. */
export interface PublicInitDeps {
  readStdin?: () => Promise<string>
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
const EMAIL = /^[^\s@,;'"]+@[^\s@,;'"]+\.[^\s@,;'"]+$/

async function readFirstLine(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** One line, trimmed. Never echoed: an error about it names the flag, not the value. */
async function readToken(read: () => Promise<string>): Promise<string> {
  const token = ((await read()).split(/\r?\n/)[0] ?? '').trim()
  if (!token) throw new UsageError('--cloudflare-token-stdin was given but standard input held no token')
  if (/[\s"'#\\]/.test(token)) throw new UsageError('the token on standard input is not a valid API token')
  return token
}

export interface PublicInitPlan {
  values: Record<string, string>
  records: Array<{ type: 'A' | 'AAAA'; name: string; content: string; proxied: false }>
  panelHost: string
}

/** Pure: validates the arguments and builds what would be written. The token is not part of it. */
export function planPublicInit(options: PublicInitOptions): PublicInitPlan {
  const domain = options.domain
  if (!domain)
    throw new UsageError('--domain is required', 'portta public init --domain example.com --email you@example.com')
  if (!HOSTNAME.test(domain))
    throw new UsageError(`--domain must be a lowercase hostname with a dot, such as example.com: ${domain}`)
  const email = options.email
  if (!email) throw new UsageError('--email is required (the ACME contact)')
  if (!EMAIL.test(email)) throw new UsageError(`--email is not an email address: ${email}`)
  const panelHost = options.panelHost ?? domain
  if (!HOSTNAME.test(panelHost)) throw new UsageError(`--panel-host must be a lowercase hostname: ${panelHost}`)
  if (
    panelHost !== domain &&
    (!panelHost.endsWith(`.${domain}`) || panelHost.split('.').length !== domain.split('.').length + 1)
  )
    throw new UsageError(`--panel-host must be ${domain} or one label under it, covered by *.${domain}: ${panelHost}`)
  const version = options.ip === undefined ? 0 : isIP(options.ip)
  if (options.ip !== undefined && version === 0)
    throw new UsageError(`--ip is not an IPv4 or IPv6 address: ${options.ip}`)
  const type = version === 6 ? 'AAAA' : 'A'
  const content = options.ip ?? '<server-ip>'
  return {
    panelHost,
    values: {
      PORTTA_PROFILE: 'remote-public',
      PUBLIC_ENABLED: 'true',
      PUBLIC_DOMAIN: domain,
      PORTTA_DOMAIN_MODE: 'custom',
      PORTTA_DOMAIN: domain,
      TLS_ENABLED: 'true',
      TLS_MODE: 'acme',
      ACME_EMAIL: email,
      ACME_DNS_PROVIDER: 'cloudflare',
      PORTTA_WEB: 'true',
      PORTTA_WEB_EXPOSE: 'domain',
      PORTTA_PANEL_ADVERTISED_HOST: panelHost,
      // The address a browser types, so session cookies are Secure and the panel's origin checks match.
      PORTTA_PANEL_URL: `https://${panelHost}`,
      PORTTA_AUTH_MODE: 'required',
    },
    records: [
      { type, name: domain, content, proxied: false },
      { type, name: `*.${domain}`, content, proxied: false },
    ],
  }
}

export async function publicInit(
  options: PublicInitOptions,
  command: Command,
  deps: PublicInitDeps = {},
): Promise<void> {
  const global = command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
  const plan = planPublicInit(options)
  const token = options.cloudflareTokenStdin ? await readToken(deps.readStdin ?? readFirstLine) : undefined
  const context = gatewayContext({ profile: global.profile })
  const dryRun = options.dryRun === true

  if (context.config.tcpEnabled)
    throw new RefusedError('public access cannot be configured while TCP entrypoints are active')
  // Fail closed, as `public enable` does. Without Docker there is nothing running
  // to be open, which only a dry run may assume.
  let running: Awaited<ReturnType<typeof inspectContainers>> = []
  try {
    running = await inspectContainers(true)
  } catch (error) {
    if (!dryRun) throw error
  }
  const ungated = ungatedContainers(running)
  if (ungated.length > 0)
    throw new RefusedError(
      `these running services route with no login gate, so they would be open on a public host: ${ungated.join(', ')}`,
      'stop each project (portta runtime down <path>), configure public access, then portta adopt and portta runtime up it again',
    )

  const path = join(context.root, '.env')
  const existing = parseEnv(readEnvFile(path))
  const values = token === undefined ? plan.values : { ...plan.values, CF_DNS_API_TOKEN: token }
  const changedKeys = Object.entries(values)
    .filter(([key, value]) => existing.get(key) !== value)
    .map(([key]) => key)
  const tokenPresent = token !== undefined || Boolean(existing.get('CF_DNS_API_TOKEN'))

  if (!dryRun) {
    await confirm(
      `write the public-server settings for ${plan.values.PUBLIC_DOMAIN} to ${path}? Nothing is started`,
      global.yes === true,
    )
    if (changedKeys.length > 0) patchEnvFile(path, values)
  }

  const output = new Output(global)
  const result = {
    domain: plan.values.PUBLIC_DOMAIN,
    panelHost: plan.panelHost,
    dryRun,
    written: dryRun ? false : changedKeys.length > 0,
    keys: changedKeys,
    tokenSet: tokenPresent,
    records: plan.records,
    tokenPermission: 'Zone, DNS, Edit on the zone',
    next: [
      'portta up remote-public',
      'portta dns check',
      `printf %s "$PASSWORD" | portta auth bootstrap --url https://${plan.panelHost} --allow-remote --name <name> --email <email> --password-stdin`,
      'portta doctor',
    ],
  }
  if (output.json) {
    output.data(result)
    return
  }
  output.line(
    dryRun
      ? 'dry run: nothing was written'
      : changedKeys.length > 0
        ? `wrote ${path}`
        : 'already configured; nothing changed',
  )
  output.line(`${dryRun ? 'would set' : 'keys'}: ${changedKeys.length > 0 ? changedKeys.join(', ') : '(none)'}`)
  output.line()
  output.line('DNS records to create (DNS only, not proxied):')
  for (const record of plan.records) output.line(`  ${record.type}\t${record.name}\t${record.content}`)
  output.line()
  output.line('Cloudflare token permission: Zone, DNS, Edit on the zone')
  if (!tokenPresent)
    output.line('CF_DNS_API_TOKEN is not set: put the token in .env or rerun with --cloudflare-token-stdin')
  output.line()
  output.line('Create the owner as soon as DNS and the certificate answer, before sharing the address: until it')
  output.line('exists, whoever reaches the panel first can claim it at /setup. In this mode the panel has no')
  output.line('loopback port, so the command goes through its own https address.')
  output.line()
  output.line('Next:')
  for (const step of result.next) output.line(`  ${step}`)
}
