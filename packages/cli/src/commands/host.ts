import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { STALE_AFTER_SECONDS } from 'portta-core'
import { hostListen, hostStateDir, hostTokenFile, readOrCreateToken, resolveHostStateDir } from 'portta-host'
import { gatewayContext, LOCAL_DEV_VERSION } from '../context.js'
import { collectEnvironmentReport } from '../environment/index.js'
import { collectHostSecurityReport, hostSecurityContext } from '../environment/security/index.js'
import { writeHostSecurityReport } from '../environment/security/store.js'
import { writeEnvironmentReport } from '../environment/store.js'
import { CliError, PreconditionError } from '../errors.js'
import { collectSnapshot } from '../metrics/collect.js'
import { collectorRunning, runCollectorLoop, startCollector, stopCollector } from '../metrics/lifecycle.js'
import { currentFile } from '../metrics/paths.js'
import { readCurrent, writeCurrent } from '../metrics/store.js'
import { Output } from '../output.js'
import { runForeground, spawnDetached } from '../process.js'
import { CLI_VERSION } from '../version.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
    loop?: boolean
  }
}

export async function collectHostResources(root: string, profile?: string): Promise<string> {
  const snapshot = await collectSnapshot(root)
  const metrics = writeCurrent(root, snapshot)
  const [environment, security] = await Promise.all([
    collectEnvironmentReport(),
    collectHostSecurityReport(root, undefined, hostSecurityContext(root, profile)),
  ])
  writeEnvironmentReport(root, environment)
  writeHostSecurityReport(root, security)
  return metrics
}

export async function environmentReport(command: Command): Promise<void> {
  const profile = globals(command).profile
  const context = gatewayContext({ profile })
  const [report, security] = await Promise.all([
    collectEnvironmentReport(),
    collectHostSecurityReport(context.root, undefined, hostSecurityContext(context.root, profile)),
  ])
  const target = writeEnvironmentReport(context.root, report)
  const securityTarget = writeHostSecurityReport(context.root, security)
  const output = new Output(globals(command))
  if (output.json) output.data({ file: target, securityFile: securityTarget, ...report })
  else output.progress(`wrote ${target} and ${securityTarget}`)
}

export async function ensureMetricsCollector(profile: string | undefined, output: Output): Promise<void> {
  try {
    const context = gatewayContext({ profile })
    const { pid, started } = startCollector(context.root, context.config.profile)
    if (started) output.progress(`host metrics collector started (pid ${pid})`)
  } catch (error) {
    output.warning(`Host metrics collector could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function stopMetricsCollector(profile: string | undefined, output: Output): void {
  try {
    const context = gatewayContext({ profile, required: false })
    if (stopCollector(context.root)) output.progress('host metrics collector stopped')
  } catch {
    // down still succeeds if the collector was already gone
  }
}

export async function hostCollect(command: Command): Promise<void> {
  const profile = globals(command).profile
  const context = gatewayContext({ profile })
  const target = await collectHostResources(context.root, profile)
  const output = new Output(globals(command))
  if (output.json) {
    output.data({ file: target, collected: true })
    return
  }
  output.progress(`wrote ${target}`)
}

export async function hostWatch(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  if (options.loop) {
    await runCollectorLoop(context.root, undefined, options.profile)
    return
  }
  const output = new Output(options)
  const { pid, started } = startCollector(context.root, context.config.profile)
  if (output.json) {
    output.data({ pid, started, file: currentFile(context.root) })
    return
  }
  output.progress(
    started ? `host metrics collector started (pid ${pid})` : `host metrics collector already running (pid ${pid})`,
  )
}

export async function hostStatus(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const pid = collectorRunning(context.root)
  const snapshot = readCurrent(context.root)
  const now = Math.floor(Date.now() / 1000)
  const ageSeconds = snapshot ? Math.max(0, now - snapshot.collectedAt) : null
  const stale = ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS
  const payload = {
    running: pid !== null,
    pid,
    collectedAt: snapshot?.collectedAt ?? null,
    ageSeconds,
    stale,
    file: currentFile(context.root),
  }
  const output = new Output(options)
  if (output.json) {
    output.data(payload)
    return
  }
  if (pid === null) output.line('collector: stopped')
  else output.line(`collector: running (pid ${pid})`)
  if (ageSeconds === null) output.line('last collect: never')
  else output.line(`last collect: ${ageSeconds}s ago${stale ? ' (stale)' : ''}`)
}

/**
 * The daemon's token, created before Compose mounts it into the panel.
 *
 * Whenever the panel is on, because the overlay that mounts it now is too: the
 * panel reaches `gh` through the daemon (ADR 0018), so the connection is part
 * of having a panel rather than part of having Task Flow. Docker turns a bind
 * mount of a missing file into an empty directory, and a directory where the
 * token belongs would stop the daemon from ever creating one — which is the
 * failure this exists to prevent, and it now applies to every installation.
 */
export function ensureHostToken(context: { root: string; config: { webEnabled: boolean } }): string | null {
  if (!context.config.webEnabled) return null
  const file = hostTokenFile(hostStateDir(context.root))
  readOrCreateToken(file)
  return file
}

/** Where the bundled daemon is, beside the CLI bundle that starts it. */
export function hostDaemonEntry(directory = import.meta.dirname): string {
  return join(directory, 'host.js')
}

/** Where a detached daemon writes its output, beside its token. */
export function hostDaemonLog(stateDir: string): string {
  return join(stateDir, 'daemon.log')
}

/** Whether a daemon already answers at `listen`. Health needs no token. */
async function hostAnswers(listen: { host: string; port: number }): Promise<boolean> {
  const host = listen.host === '0.0.0.0' || listen.host === '::' ? '127.0.0.1' : listen.host
  try {
    const response = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${listen.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * `portta host serve`: the host daemon, in the foreground or detached.
 *
 * A child process rather than an import, so the daemon is the same program
 * whether this command, a service manager or a detached start runs it. The
 * installation's `.env` is the environment it reads, so `PORTTA_HOST_BIND` and
 * the other daemon settings set there apply without exporting them.
 */
export async function hostServe(command: Command): Promise<void> {
  const options = globals(command) as ReturnType<typeof globals> & { detach?: boolean }
  const context = gatewayContext({ profile: options.profile })
  const entry = hostDaemonEntry()
  if (!existsSync(entry)) {
    // A checkout builds the daemon beside the CLI. Anything else is a bundle
    // without one: the copy `setup` places under <root>/bin serves the
    // applier only, and the daemon is what the npm package carries.
    throw new PreconditionError(
      `the host daemon is not built: ${entry}`,
      CLI_VERSION === LOCAL_DEV_VERSION
        ? 'npm run build --workspace=@codions/portta'
        : `the copy under ${join(context.root, 'bin')} serves the applier only; run this with the CLI from npm: npm install -g @codions/portta`,
    )
  }
  const stateDir = resolveHostStateDir(context.root, context.env)
  const listen = hostListen(context.env)
  const output = new Output(options)
  const env = { ...context.env, PORTTA_ROOT: context.root, PORTTA_HOST_STATE_DIR: stateDir }

  if (options.detach) {
    if (await hostAnswers(listen)) {
      if (output.json) output.data({ running: true, started: false, host: listen.host, port: listen.port })
      else output.progress(`the host daemon already answers on ${listen.host}:${listen.port}`)
      return
    }
    // The token first, so a caller can read it as soon as this returns.
    readOrCreateToken(hostTokenFile(stateDir))
    const pid = spawnDetached(process.execPath, [entry], { cwd: context.root, env, logFile: hostDaemonLog(stateDir) })
    if (output.json) output.data({ running: true, started: true, pid: pid ?? null, log: hostDaemonLog(stateDir) })
    else
      output.progress(
        `host daemon started on ${listen.host}:${listen.port} (pid ${pid}, log ${hostDaemonLog(stateDir)})`,
      )
    return
  }

  output.progress(`starting the host daemon on ${listen.host}:${listen.port} (token ${hostTokenFile(stateDir)})`)
  const code = await runForeground(process.execPath, [entry], { cwd: context.root, env })
  if (code !== 0) throw new CliError(`the host daemon exited with ${code}`)
}
