import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import type { Command } from 'commander'
import { patchEnvFile } from 'portta-core'
import { confirm } from '../confirm.js'
import { composeArguments, gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
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

export async function networkStatus(options: { publicIp?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const containers = await inspectContainers()
  const bindings = containers.flatMap((container) =>
    container.ports
      .filter((port) => port.publicPort !== null)
      .map((port) => ({
        container: container.name,
        ip: port.ip,
        hostPort: port.publicPort,
        containerPort: port.privatePort,
        protocol: port.type,
      })),
  )
  let publicIp: string | null = null
  if (options.publicIp) {
    try {
      const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) })
      publicIp = response.ok ? await response.text() : null
    } catch {
      /* optional */
    }
  }
  const result = {
    instance: { name: context.config.projectName },
    bindAddress: context.config.bindAddress,
    publicIp,
    bindings,
    publicBindings: bindings.filter((binding) => ['0.0.0.0', '::'].includes(binding.ip)),
  }
  const output = new Output(global)
  if (output.json) output.data(result)
  else {
    output.line(`gateway bind: ${result.bindAddress}`)
    if (publicIp) output.line(`public ip: ${publicIp}`)
    for (const binding of bindings)
      output.line(
        `${binding.ip}:${binding.hostPort}\t${binding.container}\t${binding.containerPort}/${binding.protocol}`,
      )
  }
}

export async function publicStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const result = {
    enabled: context.config.publicEnabled,
    profile: context.config.profile,
    domain: context.config.publicDomain,
    bindAddress: context.config.bindAddress,
  }
  const output = new Output(global)
  if (output.json) output.data(result)
  else output.line(result.enabled ? `enabled on ${result.domain ?? '<unset>'}` : 'disabled')
}

async function writeSetting(key: string, value: string, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const path = join(context.root, '.env')
  patchEnvFile(path, { [key]: value })
}

export async function publicEnable(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  // A derived base is a domain. Requiring PUBLIC_DOMAIN on top of it would mean
  // buying one to publish on a name that already resolves here.
  // See docs/development/adr/0022-project-domain-modes.md.
  const publicDomain =
    context.config.publicDomain ??
    (context.config.domainMode !== 'local' && context.config.domain !== 'localhost' ? context.config.domain : null)
  if (!publicDomain) {
    throw new PreconditionError(
      'public access needs a domain, and this host has only localhost',
      "portta config set domain.mode auto   derives one from this host's address",
    )
  }
  if (context.config.tcpEnabled)
    throw new RefusedError('public access cannot be enabled while TCP entrypoints are active')
  await confirm(`expose opted-in HTTP services on *.${publicDomain}?`, global.yes === true)
  await writeSetting('PUBLIC_ENABLED', 'true', command)
  if (!context.config.publicDomain) await writeSetting('PUBLIC_DOMAIN', publicDomain, command)
  await writeSetting('PORTTA_PROFILE', 'remote-public', command)
  const refreshed = gatewayContext({ profile: 'remote-public' })
  // composeArguments, not a hand-built file list: it is what carries
  // --project-directory. Without it Compose anchors every relative bind at
  // docker/compose/, so `.env`, the dynamic directory and the auth
  // store are all created there as empty directories and the gateway comes
  // back up reading none of its own configuration.
  await runProcess('docker', ['compose', ...composeArguments(refreshed), 'up', '-d'], {
    cwd: refreshed.root,
    env: refreshed.env,
    stdio: 'inherit',
  })
}

export async function publicDisable(command: Command): Promise<void> {
  await writeSetting('PUBLIC_ENABLED', 'false', command)
  await writeSetting('PORTTA_PROFILE', 'remote-private', command)
  new Output(globals(command)).progress('public access disabled; run portta up to apply the private profile')
}

async function resolved(host: string): Promise<string[]> {
  try {
    return [...new Set((await lookup(host, { all: true })).map((entry) => entry.address))]
  } catch {
    return []
  }
}

export async function dnsCheck(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const domain = context.config.publicDomain ?? context.config.privateDomain ?? context.config.domain
  const hostname = `probe.${domain}`
  const addresses = await resolved(hostname)
  const result = { domain, hostname, addresses, resolves: addresses.length > 0 }
  const output = new Output(global)
  if (output.json) output.data(result)
  else output.line(result.resolves ? `${hostname} -> ${addresses.join(', ')}` : `${hostname} does not resolve`)
  if (!result.resolves) throw new PreconditionError(`wildcard DNS does not resolve for ${domain}`)
}

export async function dnsStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const result = {
    enabled: context.env.CLOUDFLARE_ENABLED === 'true',
    zone: context.env.CLOUDFLARE_ZONE ?? null,
    domain: context.config.publicDomain ?? context.config.privateDomain ?? context.config.domain,
    tokenSet: Boolean(context.env.CLOUDFLARE_API_TOKEN),
  }
  const output = new Output(global)
  if (output.json) output.data(result)
  else for (const [key, value] of Object.entries(result)) output.line(`${key}: ${String(value)}`)
}

async function cloudflare(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
  })
  const body = (await response.json()) as { success?: boolean; errors?: Array<{ message?: string }>; result?: unknown }
  if (!response.ok || !body.success)
    throw new PreconditionError(body.errors?.[0]?.message ?? `Cloudflare returned HTTP ${response.status}`)
  return body.result
}

export async function dnsSetup(options: { target?: string; dryRun?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const zone = context.env.CLOUDFLARE_ZONE
  const token = context.env.CLOUDFLARE_API_TOKEN
  const domain = context.config.publicDomain ?? context.config.privateDomain
  if (!zone || !domain) throw new PreconditionError('CLOUDFLARE_ZONE and PUBLIC_DOMAIN or PRIVATE_DOMAIN are required')
  const target = options.target
  if (!target) throw new UsageError('--target <ip> is required')
  const plan = { type: 'A', name: `*.${domain}`, content: target, ttl: 1, proxied: false }
  const output = new Output(global)
  if (options.dryRun || !token) {
    output.data(plan)
    if (!token && !options.dryRun)
      throw new PreconditionError(
        'CLOUDFLARE_API_TOKEN is not set',
        'create the printed record manually or set a scoped Zone:DNS:Edit token',
      )
    return
  }
  await confirm(`create or update ${plan.name} -> ${target} in Cloudflare?`, global.yes === true)
  const zones = (await cloudflare(`/zones?name=${encodeURIComponent(zone)}`, token)) as Array<{ id: string }>
  if (!zones[0]) throw new PreconditionError(`Cloudflare zone not found: ${zone}`)
  const records = (await cloudflare(
    `/zones/${zones[0].id}/dns_records?type=A&name=${encodeURIComponent(plan.name)}`,
    token,
  )) as Array<{ id: string }>
  const route = records[0] ? `/zones/${zones[0].id}/dns_records/${records[0].id}` : `/zones/${zones[0].id}/dns_records`
  await cloudflare(route, token, { method: records[0] ? 'PUT' : 'POST', body: JSON.stringify(plan) })
  output.progress(`configured ${plan.name} -> ${target}`)
}
