import { patchEnvFile } from 'portta-core'
// `portta tunnel`: publish over HTTPS without opening a port.
//
// Cloudflare Tunnel is an optional exposure provider, never a dependency
// (docs/development/adr/0025-cloudflare-tunnel.md). Nothing here runs, and no container
// exists, until somebody enables it.
//
// What this command owns, and what it deliberately does not:
//
//   Portta      writes the connector's config and credentials, runs the
//               container, reports what it observes
//   Cloudflare  the tunnel, the DNS record and any Access policy — all created
//               by the operator, in their own account, and never touched here
//
// Portta holds no Cloudflare API token and cannot change that account. It asks
// for the tunnel token, which is the credential the connector needs and nothing
// more: it cannot create, delete or reconfigure anything in the dashboard.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReadStream } from 'node:tty'
import type { Command } from 'commander'
import {
  attachment,
  describeTunnel,
  parseTunnelToken,
  renderTunnelConfig,
  renderTunnelCredentials,
  type TunnelStatus,
  tunnelDnsTarget,
  tunnelStatusFrom,
} from 'portta-core'
import { composeArguments, type GatewayContext, gatewayContext } from '../context.js'
import { PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

/** Everything the connector reads lives here, and the directory is owner-only. */
export function tunnelPaths(root: string) {
  const directory = join(root, 'state/cloudflared')
  return { directory, config: join(directory, 'config.yml'), credentials: join(directory, 'credentials.json') }
}

export function tunnelContainer(env: Record<string, string | undefined>): string {
  return `${env.PORTTA_PROJECT_NAME || 'portta'}-cloudflared-1`
}

export function tunnelConfigured(root: string): boolean {
  const paths = tunnelPaths(root)
  return existsSync(paths.config) && existsSync(paths.credentials)
}

/**
 * Where the connector reaches the proxy.
 *
 * Under the Tailscale attachment Traefik has no name of its own on the shared
 * network, so the container that owns the namespace is the right target.
 */
export function defaultOrigin(context: GatewayContext): string {
  const attached = attachment({ profile: context.config.profile, tailscaleEnabled: context.config.tailscaleEnabled })
  const port = context.env.PORTTA_HTTP_PORT || '80'
  return `http://${attached === 'tailscale' ? 'tailscale' : 'traefik'}:${port}`
}

async function containerFacts(context: GatewayContext) {
  const container = tunnelContainer(context.env)
  const state = await runProcess('docker', ['inspect', '-f', '{{.State.Status}}', container], { reject: false })
  const health = await runProcess(
    'docker',
    ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{end}}', container],
    { reject: false },
  )
  const logs = await runProcess('docker', ['logs', '--tail', '200', container], { reject: false })
  return {
    container,
    state: state.failed ? null : state.stdout.trim() || null,
    health: health.failed ? null : health.stdout.trim() || null,
    logTail: `${logs.stdout}${logs.stderr}`,
  }
}

async function readStatus(
  context: GatewayContext,
): Promise<{ status: TunnelStatus; container: string; containerState: string }> {
  const facts = await containerFacts(context)
  const status = tunnelStatusFrom({
    tokenConfigured: tunnelConfigured(context.root),
    zoneConfigured: Boolean(context.env.CLOUDFLARE_TUNNEL_ZONE),
    enabled: context.config.tunnelEnabled,
    containerState: facts.state,
    containerHealth: facts.health,
    logTail: facts.logTail,
  })
  return { status, container: facts.container, containerState: facts.state ?? 'absent' }
}

export async function tunnelStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const output = new Output(global)
  const { status, container, containerState } = await readStatus(context)
  const zone = context.env.CLOUDFLARE_TUNNEL_ZONE ?? ''
  const id = context.env.CLOUDFLARE_TUNNEL_ID ?? ''
  // The token is never printed, only whether there is one.
  const credential = existsSync(tunnelPaths(context.root).credentials)

  if (output.json) {
    output.data({
      state: status.state,
      detail: status.detail,
      hint: status.hint,
      zone: zone || null,
      wildcard: zone ? `*.${zone}` : null,
      tunnel: id || null,
      connector: { container, state: containerState },
      credential,
    })
    return
  }

  output.line('')
  output.line('Cloudflare Tunnel')
  output.line('')
  output.line(`  state       ${status.state}`)
  output.line(`  domain      ${zone || '<unset>'}`)
  if (zone) output.line(`  wildcard    *.${zone}`)
  output.line(`  tunnel      ${id || '<unset>'}`)
  output.line(`  connector   ${container} (${containerState})`)
  output.line(`  credential  ${credential ? 'configured' : 'not set'}`)
  output.line('')

  if (status.state === 'connected') output.progress(`carrying traffic for *.${zone}`)
  else if (status.state === 'starting' || status.state === 'not-configured' || status.state === 'configured')
    output.progress(status.detail)
  else output.error(status.detail)
  const hint = cliHint(status)
  if (hint) output.hint(hint)
}

/**
 * `tunnelStatusFrom` is shared with the panel, whose hints name panel pages —
 * "Settings -> Cloudflare Tunnel" is not something a reader in a terminal can
 * act on. Every state therefore gets its answer here rather than falling
 * through to the shared wording, and a test asserts no panel page name can
 * reach a terminal.
 */
export function cliHint(status: TunnelStatus): string | null {
  switch (status.state) {
    case 'not-configured':
      return 'portta tunnel setup --zone <domain>'
    case 'configured':
      return 'portta tunnel enable'
    case 'config-error':
      return 'portta tunnel logs'
    case 'auth-error':
      return 'the tunnel may have been deleted, or the token belongs to another account: portta tunnel setup --zone <domain>'
    case 'disconnected':
      return 'portta tunnel logs   (the connector dials out on 7844/udp and 443/tcp)'
    case 'starting':
    case 'connected':
      return null
  }
}

/**
 * Read the token from the terminal with echo off.
 *
 * From `/dev/tty`, not stdin: this command may be at the end of a pipe, and a
 * token typed into a pipe would never arrive. The value is never echoed, never
 * logged and never put on a command line.
 */
async function promptForToken(): Promise<string> {
  let tty: ReturnType<typeof openSync>
  try {
    tty = openSync('/dev/tty', 'r')
  } catch {
    throw new PreconditionError(
      'no terminal available to read the token',
      'portta tunnel setup --zone <domain> --token-file <file>',
    )
  }

  process.stderr.write('Tunnel token (input is hidden): ')
  const input = new ReadStream(tty as unknown as number)
  const restore = input.isTTY ? () => input.setRawMode(false) : () => {}
  if (input.isTTY) input.setRawMode(true)

  try {
    return await new Promise<string>((resolve) => {
      let value = ''
      input.on('data', (chunk: Buffer) => {
        for (const byte of chunk) {
          // Enter ends the read; Ctrl-C abandons it, and an empty token is
          // refused by the caller with a message rather than written out.
          if (byte === 0x0d || byte === 0x0a) {
            process.stderr.write('\n')
            resolve(value.trim())
            return
          }
          if (byte === 0x03) {
            process.stderr.write('\n')
            resolve('')
            return
          }
          if (byte === 0x7f || byte === 0x08) value = value.slice(0, -1)
          else value += String.fromCharCode(byte)
        }
      })
    })
  } finally {
    restore()
    input.destroy()
    closeSync(tty)
  }
}

export interface TunnelSetupOptions {
  zone?: string
  tokenFile?: string
  origin?: string
  apex?: boolean
  token?: string
}

export async function tunnelSetup(options: TunnelSetupOptions, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)

  // Deliberately refused rather than unsupported: a credential passed as an
  // argument is visible in `ps` to every user on the host, and in the shell
  // history of whoever ran it.
  if (options.token !== undefined) {
    throw new UsageError(
      'a token must not be passed as an argument: it would be visible in `ps` and in your shell history',
      `portta tunnel setup --zone ${options.zone ?? '<domain>'} --token-file <file>, or omit it to be prompted`,
    )
  }
  if (!options.zone)
    throw new UsageError('--zone is required', 'the domain whose wildcard points at the tunnel, e.g. example.com')

  const context = gatewayContext({ profile: global.profile })
  let token: string
  if (options.tokenFile) {
    if (!existsSync(options.tokenFile)) throw new UsageError(`no such file: ${options.tokenFile}`)
    token = readFileSync(options.tokenFile, 'utf8').replace(/\s+/g, '')
  } else {
    token = await promptForToken()
  }
  if (!token) throw new UsageError('no token was given')

  const paths = tunnelPaths(context.root)
  mkdirSync(paths.directory, { recursive: true })
  // The directory holds a credential; nothing else on the host needs to read it.
  chmodSync(paths.directory, 0o700)

  let credentials: ReturnType<typeof parseTunnelToken>
  try {
    credentials = parseTunnelToken(token)
  } catch (error) {
    throw new UsageError(
      `the token was refused: ${error instanceof Error ? error.message : String(error)}`,
      'copy the whole eyJ... string from the Cloudflare dashboard, not the install command around it',
    )
  }
  writeFileSync(paths.credentials, renderTunnelCredentials(credentials), { mode: 0o600 })
  chmodSync(paths.credentials, 0o600)

  const origin = options.origin || defaultOrigin(context)
  const config = {
    id: credentials.TunnelID,
    zone: options.zone,
    origin,
    credentialsFile: '/etc/cloudflared/credentials.json',
    includeApex: options.apex ?? false,
  }
  writeFileSync(paths.config, renderTunnelConfig(config))

  const envPath = join(context.root, '.env')
  patchEnvFile(envPath, { CLOUDFLARE_TUNNEL_ZONE: options.zone, CLOUDFLARE_TUNNEL_ID: credentials.TunnelID })

  if (output.json) {
    output.data({
      zone: options.zone,
      tunnel: credentials.TunnelID,
      origin,
      routes: describeTunnel(config),
      dns: { type: 'CNAME', name: `*.${options.zone}`, target: tunnelDnsTarget(credentials.TunnelID), proxied: true },
    })
    return
  }

  output.progress('the connector is configured')
  output.line('')
  output.line(`  zone       ${options.zone}`)
  output.line(`  tunnel     ${credentials.TunnelID}`)
  output.line(`  origin     ${origin}`)
  for (const route of describeTunnel(config)) output.line(`  routes     ${route}`)
  output.line('')
  output.line('One DNS record makes every project hostname work, now and in future:')
  output.line('')
  output.line('  Type    CNAME')
  output.line(`  Name    *.${options.zone}`)
  output.line(`  Target  ${tunnelDnsTarget(credentials.TunnelID)}`)
  output.line('  Proxy   on (orange cloud)')
  output.line('')
  output.line('Then: portta tunnel enable')
}

export async function tunnelEnable(command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  let context = gatewayContext({ profile: global.profile })
  if (!tunnelConfigured(context.root)) {
    throw new PreconditionError('the connector is not configured', 'portta tunnel setup --zone <domain>')
  }
  const envPath = join(context.root, '.env')
  patchEnvFile(envPath, { CLOUDFLARE_TUNNEL_ENABLED: 'true' })
  output.progress('Cloudflare Tunnel enabled')
  output.progress('starting the connector')

  // The overlay is selected from the same variable, so `up` is all it takes.
  context = gatewayContext({ profile: global.profile, overrides: { CLOUDFLARE_TUNNEL_ENABLED: 'true' } })
  const result = await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--remove-orphans'], {
    cwd: context.root,
    env: context.env,
    stdio: 'inherit',
    reject: false,
  })
  if (result.failed) throw new PreconditionError('the connector did not start', 'portta tunnel logs')
  await tunnelStatus(command)
}

export async function tunnelDisable(options: { forget?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  output.progress('stopping the connector')

  // Stop before flipping the variable: once it is false the overlay is not
  // selected, and Compose would no longer know the container belongs to it.
  const running = gatewayContext({ profile: global.profile, overrides: { CLOUDFLARE_TUNNEL_ENABLED: 'true' } })
  await runProcess('docker', ['compose', ...composeArguments(running), 'rm', '-sf', 'cloudflared'], {
    cwd: running.root,
    env: running.env,
    reject: false,
  })

  const envPath = join(running.root, '.env')
  const values: Record<string, string> = { CLOUDFLARE_TUNNEL_ENABLED: 'false' }
  if (options.forget) {
    const paths = tunnelPaths(running.root)
    rmSync(paths.config, { force: true })
    rmSync(paths.credentials, { force: true })
    values.CLOUDFLARE_TUNNEL_ID = ''
  }
  patchEnvFile(envPath, values)
  output.progress(
    options.forget
      ? 'the connector is stopped and its configuration removed'
      : 'the connector is stopped; its configuration is kept for re-enabling',
  )

  output.line('')
  output.line('nothing was changed in your Cloudflare account')
  output.line('  The tunnel, the DNS record and any Access policy are still there.')
  output.line('  Remove them yourself if you want them gone.')
}

export async function tunnelLogs(options: { lines?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const result = await runProcess('docker', ['logs', '--tail', options.lines ?? '50', tunnelContainer(context.env)], {
    stdio: 'inherit',
    reject: false,
  })
  if (result.failed) throw new PreconditionError('the connector container does not exist', 'portta tunnel enable')
}

/**
 * How a status code from outside should be read.
 *
 * 404 is the *success* case: a name nothing routes to, answered by Traefik,
 * proves the whole path — edge, connector, proxy — without needing a live
 * service to exist.
 */
export function describeProbe(code: number): { ok: boolean; detail: string; hint: string | null } {
  if (code === 404) {
    return {
      ok: true,
      detail:
        'the tunnel is carrying traffic (404 from the gateway). Traefik answered, which means Cloudflare -> tunnel -> connector -> Traefik all work; 404 is correct here, because nothing is routed at that name.',
      hint: null,
    }
  }
  if (code === 200 || (code >= 300 && code < 400))
    return { ok: true, detail: `the tunnel is carrying traffic (${code})`, hint: null }
  if (code === 530)
    return { ok: false, detail: 'Cloudflare has no connector for this tunnel (530)', hint: 'portta tunnel status' }
  if (code === 502 || code === 504)
    return {
      ok: false,
      detail: `the connector answered but could not reach the gateway (${code})`,
      hint: 'portta status   (is Traefik running?)',
    }
  if (code === 0) return { ok: false, detail: 'no answer at all', hint: 'check that the wildcard resolves' }
  return { ok: false, detail: `unexpected response: ${code}`, hint: null }
}

/**
 * Does a hostname under the zone actually come back?
 *
 * Asks the internet, not the container: the question is whether somebody else
 * can reach a service, and only a request from outside answers that.
 */
export async function tunnelTest(command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const zone = context.env.CLOUDFLARE_TUNNEL_ZONE
  if (!zone) throw new PreconditionError('no domain is configured', 'portta tunnel setup --zone <domain>')

  const host = `portta-tunnel-check.${zone}`
  output.progress(`asking Cloudflare for https://${host}`)
  let code = 0
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`https://${host}/`, { signal: controller.signal, redirect: 'manual' })
    code = response.status
  } catch {
    code = 0
  } finally {
    clearTimeout(timer)
  }

  const verdict = describeProbe(code)
  if (output.json) {
    output.data({ host, code, ok: verdict.ok, detail: verdict.detail, hint: verdict.hint })
    return
  }
  if (verdict.ok) output.progress(verdict.detail)
  else output.error(verdict.detail)
  if (verdict.hint) output.hint(verdict.hint)
  if (!verdict.ok)
    throw new PreconditionError(`the tunnel is not carrying traffic (${code})`, verdict.hint ?? 'portta tunnel status')
}
