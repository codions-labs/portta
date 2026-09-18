// `portta remote`: prepare and drive a gateway on another host over SSH.
//
// SSH is the transport because macOS and Linux both ship it, and because
// Tailscale SSH slots in behind the same command.
//
// Host key verification is never disabled. `accept-new` records a key the
// first time and still refuses a *changed* key, which is the attack worth
// defending against. Turning the check off appears nowhere in this file, and
// The command tests fail if it ever does.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'
import type { Command } from 'commander'
import { GATEWAY_PROFILES, isGatewayProfile } from 'portta-core'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess, spawnDetached } from '../process.js'

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
 * The SSH options every remote call shares.
 *
 * `accept-new` is the strongest policy that still allows a first connection
 * without a manual `ssh-keyscan`. It is never turned off: that would accept a
 * key that changed, which is exactly what host key verification exists for.
 */
export function sshArguments(target: string, env: Record<string, string | undefined>, extra: string[] = []): string[] {
  return [
    '-o',
    `StrictHostKeyChecking=${env.PORTTA_SSH_HOST_KEY_POLICY || 'accept-new'}`,
    '-o',
    'ConnectTimeout=15',
    '-o',
    `BatchMode=${env.PORTTA_SSH_BATCH || 'no'}`,
    ...extra,
    target,
  ]
}

function requireTarget(target: string | undefined): string {
  if (!target || target.startsWith('-')) {
    throw new UsageError('a target is required, e.g. portta remote bootstrap user@host')
  }
  return target
}

async function ssh(
  context: { env: Record<string, string | undefined> },
  target: string,
  remoteCommand: string,
  options: { interactive?: boolean } = {},
) {
  return runProcess('ssh', [...sshArguments(target, context.env), remoteCommand], {
    env: context.env as NodeJS.ProcessEnv,
    stdio: options.interactive ? 'inherit' : 'pipe',
    reject: false,
  })
}

export async function remoteExec(target: string, args: string[], command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile, required: false })
  requireTarget(target)
  const forwarded = args[0] === '--' ? args.slice(1) : args
  if (forwarded.length === 0) throw new UsageError('no command given', 'portta remote exec user@host -- <command>')
  const result = await runProcess('ssh', [...sshArguments(target, context.env), ...forwarded], {
    env: context.env as NodeJS.ProcessEnv,
    stdio: 'inherit',
    reject: false,
  })
  if (result.exitCode !== 0) process.exitCode = result.exitCode
}

/** Run one of the gateway's own read commands on the far side. */
export async function remoteGateway(
  name: 'status' | 'doctor' | 'urls',
  target: string,
  command: Command,
): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile, required: false })
  requireTarget(target)
  const directory = context.env.PORTTA_REMOTE_DIR || 'portta'
  const json = global.json ? ' --json' : ''
  const result = await runProcess(
    'ssh',
    [...sshArguments(target, context.env), `cd '${directory}' && ./bin/portta ${name}${json}`],
    {
      env: context.env as NodeJS.ProcessEnv,
      stdio: 'inherit',
      reject: false,
    },
  )
  if (result.exitCode !== 0) process.exitCode = result.exitCode
}

export interface RemoteBootstrapOptions {
  profile?: string
  dir?: string
  repo?: string
  branch?: string
  installDocker?: boolean
  dryRun?: boolean
}

export async function remoteBootstrap(
  target: string,
  options: RemoteBootstrapOptions,
  command: Command,
): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  requireTarget(target)

  const profile = options.profile ?? 'remote-private'
  if (!isGatewayProfile(profile)) {
    throw new UsageError(`unknown profile: ${profile}`, `one of ${GATEWAY_PROFILES.join(', ')}`)
  }
  const directory = options.dir ?? 'portta'
  const branch = options.branch ?? 'main'

  let repo = options.repo
  if (!repo) {
    const origin = await runProcess('git', ['-C', context.root, 'remote', 'get-url', 'origin'], { reject: false })
    repo = origin.failed ? '' : origin.stdout.trim()
    if (!repo) throw new PreconditionError('could not determine the repository URL', 'pass --repo <url>')
  }

  output.progress(`Remote bootstrap: ${target}`)
  output.progress(`  profile      ${profile}`)
  output.progress(`  directory    ~/${directory}`)
  output.progress(`  repository   ${repo}`)
  output.progress(`  branch       ${branch}`)
  if (options.dryRun) output.progress(`dry run; nothing will be changed on ${target}`)

  output.progress('1/6  Reaching the host')
  const reach = await ssh(context, target, 'uname -s -m; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"')
  if (reach.failed) {
    throw new PreconditionError(
      `could not connect to ${target}`,
      'check the host, your SSH key, and that the host key is accepted; with Tailscale SSH configured the same target works over the tailnet',
    )
  }
  for (const line of reach.stdout.trim().split('\n')) output.progress(`  ${line}`)

  output.progress('2/6  Docker')
  const hasDocker = await ssh(context, target, 'command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1')
  if (!hasDocker.failed) {
    output.progress('Docker is installed and running')
    const versions = await ssh(
      context,
      target,
      'docker version --format "  engine {{.Server.Version}}"; docker compose version --short 2>/dev/null | sed "s/^/  compose /"',
    )
    for (const line of versions.stdout.trim().split('\n')) if (line) output.progress(line)
  } else {
    output.warning(`Docker is not available on ${target}`)
    if (!options.installDocker) {
      throw new PreconditionError(
        'Docker is required on the remote host',
        're-run with --install-docker to install it, or install it yourself first; see docs/product/guides/remote-bootstrap.md',
      )
    }
    // Docker's convenience script is the vendor's own, but it is still remote
    // code execution as root. Say so, show it, and ask.
    output.warning(`this runs Docker's official installation script as root on ${target}`)
    output.hint('it is fetched from https://get.docker.com and piped to sh')
    await confirm(`Install Docker on ${target}?`, global.yes ?? false)
    if (!options.dryRun) {
      const installed = await ssh(
        context,
        target,
        'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sudo sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh',
        { interactive: true },
      )
      if (installed.failed) throw new PreconditionError('Docker installation failed')
      output.progress('Docker installed')
    }
  }

  output.progress('3/6  Repository')
  if (options.dryRun) {
    output.progress(`would clone or update ${repo} into ~/${directory}`)
  } else {
    const cloned = await ssh(
      context,
      target,
      [
        'set -e',
        `if [ -d '${directory}/.git' ]; then`,
        `  cd '${directory}' && git fetch --quiet origin && git checkout --quiet '${branch}' && git pull --quiet --ff-only`,
        "  echo '  updated existing checkout'",
        'else',
        `  git clone --quiet --branch '${branch}' '${repo}' '${directory}'`,
        "  echo '  cloned'",
        'fi',
      ].join('\n'),
    )
    if (cloned.failed) throw new PreconditionError('could not clone or update the repository', cloned.stderr.trim())
    for (const line of cloned.stdout.trim().split('\n')) if (line) output.progress(line)
  }

  output.progress('4/6  Configuration')
  // Never overwrite a .env that is already there: it holds the host's secrets.
  const hasEnv = await ssh(context, target, `test -f '${directory}/.env'`)
  if (!hasEnv.failed) {
    output.progress('.env already exists on the remote host; left untouched')
  } else if (options.dryRun) {
    output.progress('would create .env from .env.example')
  } else {
    const created = await ssh(context, target, `cd '${directory}' && cp .env.example .env && chmod 600 .env`)
    if (!created.failed) output.progress('created .env from the example')
    const set = await ssh(
      context,
      target,
      `cd '${directory}' && sed -i.bak 's/^PORTTA_PROFILE=.*/PORTTA_PROFILE=${profile}/' .env && rm -f .env.bak`,
    )
    if (!set.failed) output.progress(`set PORTTA_PROFILE=${profile}`)
  }

  output.progress('')
  output.progress(
    'Secrets are never copied from this machine. Set TS_AUTHKEY, ACME_EMAIL and CF_DNS_API_TOKEN in the remote .env before starting a profile that needs them:',
  )
  output.progress(`  ssh ${target} 'nano ~/${directory}/.env'`)

  if (options.dryRun) {
    output.progress('dry run complete; nothing was changed')
    return
  }

  output.progress('5/6  Bootstrap and start')
  const bootstrapped = await ssh(context, target, `cd '${directory}' && ./bin/portta bootstrap --yes`, {
    interactive: true,
  })
  if (bootstrapped.failed) output.warning('remote bootstrap reported problems')

  let started = false
  try {
    await confirm(`Start the gateway on ${target} with the '${profile}' profile now?`, global.yes ?? false)
    started = true
  } catch {
    output.progress('not started; run it yourself with:')
    output.hint(`ssh ${target} 'cd ${directory} && ./bin/portta up ${profile}'`)
    return
  }

  if (started) {
    const up = await ssh(context, target, `cd '${directory}' && ./bin/portta up '${profile}'`, { interactive: true })
    if (up.failed)
      throw new PreconditionError('the gateway did not start', `ssh ${target} 'cd ${directory} && ./bin/portta logs'`)
  }

  output.progress('6/6  Diagnostics')
  await ssh(context, target, `cd '${directory}' && ./bin/portta doctor`, { interactive: true })
  await ssh(context, target, `cd '${directory}' && ./bin/portta urls`, { interactive: true })

  output.progress('Next steps')
  output.progress(`  portta remote status ${target}`)
  output.progress(`  portta remote doctor ${target}`)
  output.progress('')
  output.progress('  On the remote host:')
  output.progress('    ./bin/portta dns check          confirm the wildcard record')
  output.progress('    ./bin/portta network status     confirm what is exposed')
}

// ============================================================================
// remote access: reach a VPS's private TCP services from here
// ============================================================================
//
//   your Mac  ->  SSH (over Tailscale, or plain)  ->  VPS loopback bridge
//             ->  the project's private network   ->  postgres / redis
//
// The bridge on the VPS binds loopback there, exactly as it does locally. It is
// never turned into a public port; the tunnel is what carries it to you.

export function tunnelStateDir(root: string): string {
  return join(root, 'state/access/tunnels')
}

export interface TunnelRecord {
  id: string
  pid: number
  target: string
  project: string
  service: string
  remotePort: number
  localPort: number
  started: number
}

export function parseTunnelRecord(id: string, text: string): TunnelRecord | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (
      value.id !== id ||
      typeof value.target !== 'string' ||
      typeof value.project !== 'string' ||
      typeof value.service !== 'string'
    )
      return null
    for (const key of ['pid', 'remotePort', 'localPort', 'started']) {
      if (!Number.isInteger(value[key]) || Number(value[key]) <= 0) return null
    }
    return value as unknown as TunnelRecord
  } catch {
    return null
  }
}

export function renderTunnelRecord(record: TunnelRecord): string {
  return `${JSON.stringify(record)}\n`
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readTunnels(root: string): TunnelRecord[] {
  const directory = tunnelStateDir(root)
  if (!existsSync(directory)) return []
  const records: TunnelRecord[] = []
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json'))) {
    const path = join(directory, name)
    try {
      const record = parseTunnelRecord(basename(name, '.json'), readFileSync(path, 'utf8'))
      if (record) records.push(record)
    } catch {
      /* an unreadable record is not a tunnel; leave the file alone */
    }
  }
  return records
}

/**
 * A port nothing is listening on.
 *
 * Racy in principle. `ExitOnForwardFailure=yes` on the tunnel turns a lost race
 * into a clear error rather than a tunnel that quietly forwards nothing.
 */
export async function freeLocalPort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = 49152 + Math.floor(Math.random() * 16000)
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(candidate, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) return candidate
  }
  throw new PreconditionError('could not find a free local port')
}

export async function remoteAccessOpen(
  target: string,
  options: { project?: string; service?: string; port?: string; localPort?: string; dir?: string },
  command: Command,
): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  requireTarget(target)
  if (!options.project) throw new UsageError('--project is required')
  if (!options.service) throw new UsageError('--service is required')
  const directory = options.dir ?? 'portta'

  output.progress(`Opening the bridge on ${target}`)
  const portFlag = options.port ? ` --port '${options.port}'` : ''
  const remote = await ssh(
    context,
    target,
    `cd '${directory}' && ./bin/portta access open --project '${options.project}' --service '${options.service}'${portFlag} --quiet >/dev/null 2>&1; ` +
      `cd '${directory}' && ./bin/portta access list --json`,
  )
  if (remote.failed) {
    throw new PreconditionError(
      `could not open a bridge on ${target}`,
      remote.stderr.trim().split('\n').slice(-3).join('; '),
    )
  }

  let remotePort = 0
  try {
    const listed = JSON.parse(remote.stdout) as {
      bridges?: Array<{ project: string; service: string; local_port: string }>
    }
    const match = (listed.bridges ?? []).find(
      (bridge) => bridge.project === options.project && bridge.service === options.service,
    )
    remotePort = Number(match?.local_port ?? 0)
  } catch {
    remotePort = 0
  }
  if (!remotePort) {
    throw new PreconditionError(
      'the remote bridge did not report a port',
      `ssh ${target} 'cd ${directory} && ./bin/portta access list'`,
    )
  }
  output.progress(`remote bridge on 127.0.0.1:${remotePort}`)

  const localPort = options.localPort ? Number(options.localPort) : await freeLocalPort()

  output.progress('Opening the tunnel')
  const directoryPath = tunnelStateDir(context.root)
  mkdirSync(directoryPath, { recursive: true })
  const id = randomBytes(3).toString('hex')

  // -N: no remote command. ExitOnForwardFailure: fail loudly instead of leaving
  // a tunnel that silently forwards nothing.
  const pid = spawnDetached(
    'ssh',
    sshArguments(target, context.env, [
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-N',
      '-L',
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    ]),
    { env: context.env as NodeJS.ProcessEnv },
  )
  if (!pid) throw new PreconditionError('the SSH tunnel could not be started')

  // Give ssh a moment to fail on a bad forward before claiming success.
  await new Promise((resolve) => setTimeout(resolve, 2000))
  if (!isAlive(pid)) {
    throw new PreconditionError(
      'the SSH tunnel exited immediately',
      `check that ${target} is reachable and that ${localPort} is free locally`,
    )
  }

  const record: TunnelRecord = {
    id,
    pid,
    target,
    project: options.project,
    service: options.service,
    remotePort,
    localPort,
    started: Math.floor(Date.now() / 1000),
  }
  writeFileSync(join(directoryPath, `${id}.json`), renderTunnelRecord(record))

  if (output.json) {
    output.data({ ...record, address: `127.0.0.1:${localPort}` })
    return
  }
  output.progress('tunnel open')
  output.line('')
  output.line(`  id           ${id}`)
  output.line(`  remote       ${options.project}/${options.service}:${options.port ?? 'auto'}`)
  output.line(`  via          ${target}`)
  output.line(`  local        127.0.0.1:${localPort}`)
  output.line('')
  output.line('  point TablePlus / DBeaver / psql at that address; credentials are the project')
  output.line(`  close with: portta remote access close ${id}`)
}

export async function remoteAccessList(command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const open = readTunnels(context.root).filter((record) => isAlive(record.pid))

  if (output.json) {
    output.data({ tunnels: open.map((record) => ({ ...record, address: `127.0.0.1:${record.localPort}` })) })
    return
  }
  if (open.length === 0) {
    output.progress('no tunnels are open')
    return
  }
  output.line('ID       TARGET                 PROJECT                SERVICE        LOCAL')
  for (const record of open) {
    output.line(
      `${record.id.padEnd(8)} ${record.target.padEnd(22)} ${record.project.padEnd(22)} ${record.service.padEnd(14)} 127.0.0.1:${record.localPort}`,
    )
  }
}

export async function remoteAccessClose(
  id: string | undefined,
  options: { all?: boolean },
  command: Command,
): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const directory = tunnelStateDir(context.root)
  if (!existsSync(directory)) {
    output.progress('nothing to close')
    return
  }
  if (!id && !options.all) throw new UsageError('name a tunnel or pass --all', 'portta remote access list')

  let closed = 0
  for (const record of readTunnels(context.root)) {
    if (!options.all && record.id !== id) continue
    if (isAlive(record.pid)) {
      try {
        process.kill(record.pid)
        closed += 1
      } catch {
        /* it exited between the check and the signal */
      }
    }
    rmSync(join(directory, `${record.id}.json`), { force: true })
    // The remote bridge is the remote host's to keep or drop; closing it from
    // here would be surprising if another tunnel is using it, so say what to run.
    output.progress(`the bridge on ${record.target} is still open; close it there if you are done:`)
    output.hint(
      `portta remote exec ${record.target} -- 'cd portta && ./bin/portta access close --project ${record.project}'`,
    )
  }
  output.progress(`closed ${closed} tunnel(s)`)
}
