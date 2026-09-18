import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import {
  AUTH_BUILD_FILE,
  AUTH_DEV_FILE,
  type ContainerRecord,
  databaseFileFor,
  databaseFiles,
  parseAliases,
  patchEnvFile,
  prepareEnvFile,
  projectsFor,
  routesFor,
  type StoredAlias,
} from 'portta-core'
import { ensureCheckoutCli, reexecBuiltCli } from '../checkout-cli.js'
import { confirm } from '../confirm.js'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, identifier, inspectContainers, networkExists, requireDocker } from '../docker.js'
import { runDoctor } from '../doctor.js'
import { CliError, EXIT, PreconditionError, RefusedError } from '../errors.js'
import { ensureInstallationDirectories } from '../installation-directories.js'
import { requireLocalRelease, selectLocalRelease } from '../local-release.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { CLI_BUILD_DATE, CLI_VERSION, cliVersionLine } from '../version.js'
import { ensureApplier, removeApplier } from './apply.js'
import {
  demoStacksDown,
  demoStacksUp,
  ensureDevDemoOwner,
  panelIsReachable,
  requireDemoStacks,
  waitForPanel,
} from './demo.js'
import { ensureHostToken, ensureMetricsCollector, stopMetricsCollector } from './host.js'
import { refreshRepositories } from './repos.js'
import { ensureRunner, removeRunner } from './runner.js'
import { finishWebUp, prepareWebUp, syncForwardAuth, webUp } from './web.js'

export function checkoutLocalEnv(): Record<string, string> {
  return {
    PORTTA_WEB: 'true',
    PORTTA_WEB_DEV: 'true',
    PORTTA_WEB_BUILD: 'false',
    PORTTA_AUTH_IMAGE: '',
    PORTTA_WEB_IMAGE: '',
  }
}

function persistEnv(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  patchEnvFile(path, values)
}

function buildsLocally(command: Command): boolean {
  const files = gatewayContext({ profile: globals(command).profile }).composeFiles
  return files.includes(AUTH_BUILD_FILE) || files.includes(AUTH_DEV_FILE)
}

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

async function compose(
  command: Command,
  args: string[],
  stdio: 'inherit' | 'pipe' = 'inherit',
  extra: { reject?: boolean } = {},
) {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], {
    cwd: context.root,
    env: context.env,
    stdio,
    reject: extra.reject,
  })
}

function ensureAuthState(root: string): void {
  const authDirectory = join(root, 'state/auth')
  mkdirSync(authDirectory, { recursive: true, mode: 0o700 })
  chmodSync(authDirectory, 0o700)
  const path = join(root, '.env')
  prepareEnvFile(path)
  syncForwardAuth(root)
}

/** major.minor, which is the granularity the API contract moves at. */
function series(version: string): string {
  const parts = version.split('.')
  return `${parts[0] ?? '0'}.${parts[1] ?? '0'}`
}

/**
 * The panel's own version, read from the API it serves. Unauthenticated on
 * loopback and over the tailnet; behind Portta ForwardAuth in `public` mode, where a
 * 401 is a perfectly good answer to "is it there" and no answer at all to
 * "which version" — so that case reports the image tag instead, which is what
 * the installation pinned.
 */
async function panelReport(
  context: ReturnType<typeof gatewayContext>,
): Promise<{ version: string | null; detail: string }> {
  const image = context.env.PORTTA_WEB_IMAGE ?? ''
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : null
  if (!context.config.webEnabled) return { version: null, detail: 'disabled' }
  const host =
    context.config.webExpose === 'public' ? '127.0.0.1' : (context.env.PORTTA_WEB_BIND_ADDRESS ?? '127.0.0.1')
  try {
    const response = await fetch(`http://${host}:${context.config.webPort}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (response.status === 401)
      return {
        version: tag,
        detail: tag ? `${tag} (from the image tag; the API is behind authentication)` : 'behind authentication',
      }
    if (!response.ok) return { version: tag, detail: `unreachable (HTTP ${response.status})` }
    const body = (await response.json()) as { panelVersion?: string }
    return { version: body.panelVersion ?? tag, detail: body.panelVersion ?? 'unknown' }
  } catch {
    return { version: tag, detail: tag ? `${tag} (from the image tag; the panel did not answer)` : 'not running' }
  }
}

export async function versionCommand(command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ required: false })
  const cli = CLI_VERSION
  const gateway = context.version
  // A CLI installed from npm outlives the installation it is pointed at in
  // both directions, so it says which one it is talking to and whether the
  // two agree, rather than failing obscurely three commands later.
  const compatible = series(cli) === series(gateway)

  if (!output.json && !context.composeFiles.length) {
    output.data(cliVersionLine())
    return
  }

  const panel = await panelReport(context)
  if (output.json) {
    output.data({
      cli,
      built: CLI_BUILD_DATE ?? null,
      gateway,
      panel: panel.version,
      root: context.root,
      compatible,
      apiSeries: series(gateway),
    })
    return
  }
  output.line(cliVersionLine())
  output.line(`  gateway  ${gateway}  (${context.root})`)
  output.line(`  panel    ${panel.detail}`)
  if (!compatible) {
    output.warning(`this CLI is ${cli} and the installation is ${gateway}`)
    output.hint(
      `update the installation with portta setup, or install the matching CLI: npm install -g @codions/portta@${gateway}`,
    )
  }
}

export async function bootstrapCommand(options: { skipPull?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  output.step('checkout')
  await requireDocker()
  const composeVersion = await runProcess('docker', ['compose', 'version', '--short'], { reject: false })
  if (composeVersion.exitCode !== 0) throw new CliError('Docker Compose v2 is required', EXIT.precondition)
  prepareEnvFile(join(context.root, '.env'))
  ensureInstallationDirectories(context.root)
  ensureAuthState(context.root)
  const network = await ensureNetwork(context.config.network)
  output.progress(`${network.padEnd(8)} shared network ${context.config.network}`)
  // Explicit build/dev overlays carry checkout-only tags. Ignore those while
  // pulling the remaining pinned images; normal local-release runs select no
  // build overlay and are preflighted by `just up` instead.
  if (!options.skipPull) await compose(command, ['pull', '--ignore-buildable'])
  await doctorCommand(command)
}

export async function upCommand(
  profile: string | undefined,
  options: { attach?: boolean; demo?: boolean; localRelease?: boolean },
  command: Command,
): Promise<void> {
  if (profile) command.setOptionValueWithSource('profile', profile, 'cli')
  prepareEnvFile(join(gatewayContext({ profile: profile ?? globals(command).profile }).root, '.env'))
  if (options.localRelease) selectLocalRelease(gatewayContext({ profile: profile ?? globals(command).profile }))
  const context = gatewayContext({ profile: profile ?? globals(command).profile })
  if (options.localRelease) context.env.PORTTA_LOCAL_RELEASE = 'true'
  if (options.demo) requireDemoStacks(command)
  if (context.config.profile === 'remote-public' && context.config.tcpEnabled)
    throw new RefusedError('TCP entrypoints must not run on the remote-public profile')
  // `vpn` routes the panel on the tailnet hostname; with Traefik bound to every
  // interface that router answers the internet too, which is not what the mode
  // means. `domain` is the deliberate version of the same thing.
  if (context.config.profile === 'remote-public' && context.config.webEnabled && context.config.webExpose === 'vpn') {
    throw new RefusedError(
      'the panel must not be routed on the tailnet hostname while Traefik binds every interface',
      "portta web up --expose domain   routes it on the gateway's own domain, behind the same login page",
    )
  }
  const output = new Output(globals(command))
  const builds = buildsLocally(command)
  output.step('gateway components')
  await requireDocker()
  await requireLocalRelease(context)
  // Both networks are `external: true` in the overlays, so create each enabled
  // network explicitly before asking Compose to start the gateway.
  await ensureNetwork(context.config.network)
  if (context.config.tcpEnabled) await ensureNetwork(context.config.accessNetwork)
  ensureAuthState(context.root)
  ensureHostToken(context)
  output.progress(builds ? 'starting components, building local images' : 'starting components')
  const wait = !options.attach
  const started = await compose(
    command,
    [
      'up',
      options.attach ? '' : '-d',
      ...(builds ? ['--build'] : []),
      options.attach ? '' : '--remove-orphans',
      ...(wait ? ['--wait', '--wait-timeout', '180'] : []),
    ].filter(Boolean),
    'inherit',
    wait ? { reject: false } : {},
  )
  if (wait && started.exitCode !== 0) {
    throw new PreconditionError(
      'the gateway did not report healthy within 180s',
      'portta logs   shows what it is doing; portta doctor checks the rest',
    )
  }

  await refreshRepositories(context.config.profile, output)
  await ensureMetricsCollector(context.config.profile, output)

  // The optional applier, so the panel can recreate these containers itself.
  // Off unless PORTTA_APPLY=true, and never fatal: the gateway is up either way.
  const applier = await ensureApplier(context)
  if (applier.action === 'created')
    output.progress('ok       applier ready; the panel can apply settings without a terminal')
  if (applier.action === 'removed') output.progress('ok       applier removed (PORTTA_APPLY is false)')
  if (applier.action === 'refused') output.progress(`warn     not preparing the applier: ${applier.reason}`)
  if (applier.action === 'failed') output.progress(`warn     ${applier.reason}; settings still apply with: portta up`)

  const runner = await ensureRunner(context)
  if (runner.action === 'created')
    output.progress('ok       runner ready; the panel can operate a project without a terminal')
  if (runner.action === 'removed') output.progress('ok       runner removed (PORTTA_RUNNER is false)')
  if (runner.action === 'refused') output.progress(`warn     not preparing the runner: ${runner.reason}`)
  if (runner.action === 'failed')
    output.progress(`warn     ${runner.reason}; project operations still run from a shell`)

  if (options.demo) {
    if (!(await panelIsReachable(command))) await webUp({}, command)
    await waitForPanel(command)
    await demoStacksUp(command)
    await urlsCommand({}, command)
  }
}

/**
 * Complete checkout development setup: local Dockerfiles only, never the
 * published GHCR images. Just calls this; an installed PORTTA_HOME keeps `up`.
 * `--reset` stops every Portta-managed stack and drops its volumes first.
 * Every checkout development run creates the development owner; `--demo` also
 * starts the example stacks found in Projects Home. `portta reset` is this
 * command with `--reset`.
 */
export async function devCommand(
  profile: string | undefined,
  options: { reset?: boolean; demo?: boolean },
  command: Command,
): Promise<void> {
  if (profile) command.setOptionValueWithSource('profile', profile, 'cli')
  const existing = gatewayContext({ profile: profile ?? globals(command).profile, required: false })
  const output = new Output(globals(command))
  // `just dev` is `./bin/portta dev`. Rebuild dist first so this process is
  // the checkout, not last week's compiled CLI. bin/portta does the same
  // before exec when dist is stale, so a first dev after a pull is current.
  if (await ensureCheckoutCli(existing.root, output)) {
    await reexecBuiltCli(existing.root)
    return
  }
  if (options.demo) requireDemoStacks(command)
  const needsBootstrap = !existsSync(join(existing.root, '.env'))
  // What the whole run will do, before the first step of it starts. `dev` is
  // the longest command here and the one most likely to be mistaken for a hang.
  output.progress(
    `dev runs: ${[
      ...(options.reset ? ['wipe Portta-managed containers and volumes'] : []),
      ...(needsBootstrap ? ['prepare the checkout'] : []),
      'start gateway components',
      'start the panel',
      'create the development owner',
      ...(options.demo ? ['start example stacks from Projects Home'] : []),
      'list routed hostnames',
    ].join(' -> ')}`,
  )
  if (options.reset) await wipePorttaRuntime(command)
  if (needsBootstrap) {
    command.setOptionValueWithSource('yes', true, 'cli')
    await bootstrapCommand({ skipPull: true }, command)
  }
  persistEnv(gatewayContext({ profile: profile ?? globals(command).profile }).root, checkoutLocalEnv())
  // Prepare the panel's credentials, ownership and generated ForwardAuth
  // state before the one Compose convergence that starts the whole gateway.
  const panel = prepareWebUp({ dev: true }, command)
  await upCommand(profile, { attach: false }, command)
  // The owner has to exist before finishWebUp migrates: it talks to a
  // protected panel that answers 503 until then.
  await waitForPanel(command)
  const demoToken = await ensureDevDemoOwner(command)
  await finishWebUp(panel, command, false, demoToken)
  if (options.demo) await demoStacksUp(command, demoToken)
  await urlsCommand({}, command)
}

export async function downCommand(options: { demo?: boolean }, command: Command): Promise<void> {
  if (options.demo) await demoStacksDown(command)
  await compose(command, ['down'])
  // The applier lives outside the Compose project, so `down` does not see it.
  // `up` recreates it, and leaving a stopped gateway container behind is the one
  // thing `down` does to nothing else.
  await removeApplier()
  await removeRunner()
  stopMetricsCollector(globals(command).profile, new Output(globals(command)))
}

/**
 * What a reset removes of the panel's own persistence.
 *
 * A file, not a named volume: the panel's database is
 * `state/panel/portta.db` on this host (ADR 0037). All three WAL files, or a
 * reset leaves the most recent writes behind in a `-wal` and the next boot
 * reads them back over an empty database.
 */
export function panelDatabaseArtefacts(root: string): string[] {
  return databaseFiles(databaseFileFor(root))
}

/** Snapshots the collector and `repos scan` rewrite. Never `state/` itself. */
export const REGENERABLE_STATE_DIRS = ['state/git', 'state/metrics', 'state/environment'] as const

export function clearRegenerableState(root: string): string[] {
  const cleared: string[] = []
  for (const relative of REGENERABLE_STATE_DIRS) {
    const directory = join(root, relative)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      rmSync(join(directory, entry.name), { recursive: true, force: true })
    }
    cleared.push(relative)
  }
  return cleared
}

export function isPorttaOwnedContainer(
  container: Pick<ContainerRecord, 'labels' | 'networks'>,
  networks: { shared: string; access?: string },
): boolean {
  if (container.labels['portta.managed'] === 'true') return true
  if ((container.labels['portta.project'] ?? '').trim() !== '') return true
  if (container.networks.includes(networks.shared)) return true
  return Boolean(networks.access && container.networks.includes(networks.access))
}

export interface OwnedComposeProject {
  name: string
  workingDir: string | null
}

/** Consumer Compose projects this gateway owns. The gateway project itself is excluded. */
export function porttaOwnedComposeProjects(
  containers: Array<Pick<ContainerRecord, 'labels' | 'networks'>>,
  options: { gatewayProject: string; sharedNetwork: string; accessNetwork?: string },
): OwnedComposeProject[] {
  const grouped = new Map<string, string | null>()
  for (const container of containers) {
    if (!isPorttaOwnedContainer(container, { shared: options.sharedNetwork, access: options.accessNetwork })) continue
    const name = container.labels['com.docker.compose.project']
    if (!name || name === options.gatewayProject) continue
    if (grouped.has(name)) continue
    grouped.set(name, container.labels['com.docker.compose.project.working_dir'] || null)
  }
  return [...grouped.entries()]
    .map(([name, workingDir]) => ({ name, workingDir }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

const RESET_CONFIRMATION =
  'stop every Portta-managed stack, drop their volumes, and restart this checkout as if it were new?'

/**
 * Recreate a checkout as if it were new: every Portta-managed stack and its
 * volumes are gone, then `dev` runs again. Unrelated Compose projects stay.
 */
export async function wipePorttaRuntime(command: Command): Promise<void> {
  await confirm(RESET_CONFIRMATION, globals(command).yes === true)
  await requireDocker()
  const context = gatewayContext({ profile: globals(command).profile })
  const output = new Output(globals(command))
  output.step('Portta runtime')
  await demoStacksDown(command)
  const containers = await inspectContainers()
  for (const project of porttaOwnedComposeProjects(containers, {
    gatewayProject: context.config.projectName,
    sharedNetwork: context.config.network,
    accessNetwork: context.config.accessNetwork,
  })) {
    const name = identifier(project.name, 'compose project')
    const args = ['compose', '--project-name', name]
    const cwd = project.workingDir && existsSync(project.workingDir) ? project.workingDir : undefined
    if (cwd) args.push('--project-directory', cwd)
    args.push('down', '--volumes', '--remove-orphans')
    output.progress(`stopping ${name}`)
    await runProcess('docker', args, { cwd, stdio: 'inherit' })
  }
  await compose(command, ['down', '-v', '--remove-orphans'])
  await removeApplier()
  await removeRunner()
  stopMetricsCollector(globals(command).profile, output)
  for (const leftover of await inspectContainers()) {
    if (leftover.labels['portta.managed'] !== 'true') continue
    const name = identifier(leftover.name, 'container')
    const removed = await runProcess('docker', ['rm', '-f', name], { reject: false })
    if (removed.exitCode === 0) output.progress(`removed ${name}`)
  }
  let dropped = 0
  for (const file of panelDatabaseArtefacts(context.root)) {
    if (!existsSync(file)) continue
    rmSync(file, { force: true })
    dropped += 1
  }
  output.progress(
    dropped > 0 ? `removed the panel database (${dropped} file(s))` : 'the panel database was already absent',
  )
  const cleared = clearRegenerableState(context.root)
  if (cleared.length > 0) output.progress(`cleared ${cleared.join(', ')}`)
}

/** Alias for `dev --reset`. Kept so `just reset` stays a one-line call. */
export async function resetCommand(options: { demo?: boolean }, command: Command): Promise<void> {
  await devCommand(undefined, { reset: true, demo: options.demo }, command)
}

export async function restartCommand(command: Command): Promise<void> {
  await compose(command, ['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180'])
}
export async function logsCommand(
  service: string | undefined,
  options: { follow?: boolean; tail?: string },
  command: Command,
): Promise<void> {
  const global = globals(command)
  if (global.json) {
    const result = await compose(
      command,
      ['logs', '--no-color', '--no-log-prefix', '--tail', options.tail ?? '200', ...(service ? [service] : [])],
      'pipe',
    )
    new Output(global).data({ lines: result.stdout.split('\n').filter(Boolean) })
  } else
    await compose(command, [
      'logs',
      ...(options.follow === false ? [] : ['--follow']),
      '--tail',
      options.tail ?? '200',
      ...(service ? [service] : []),
    ])
}

export async function updateCommand(command: Command): Promise<void> {
  prepareEnvFile(join(gatewayContext({ profile: globals(command).profile }).root, '.env'))
  await compose(command, ['config', '--quiet'])
  await compose(command, ['pull', '--ignore-buildable'])
  await confirm('recreate gateway components with the pulled images?', globals(command).yes === true)
  await compose(command, ['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180'])
}

export async function inspectCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const output = new Output(options)
  // The database has no credential any more: it is a file, protected by the
  // filesystem (ADR 0037).
  const secrets = new Set(['TS_AUTHKEY', 'CF_DNS_API_TOKEN', 'PORTTA_AUTH_SECRET'])
  const configuration = Object.fromEntries(
    Object.entries(context.env)
      .filter(
        ([key]) =>
          key.startsWith('PORTTA_') ||
          ['TLS_ENABLED', 'TLS_MODE', 'PUBLIC_DOMAIN', 'PRIVATE_DOMAIN', 'TAILSCALE_ENABLED'].includes(key),
      )
      .map(([key, value]) => [key, secrets.has(key) ? (value ? '<set>' : '<unset>') : value]),
  )
  if (output.json) output.data({ profile: context.config.profile, configuration, composeFiles: context.composeFiles })
  else {
    output.line(`profile: ${context.config.profile}`)
    for (const [key, value] of Object.entries(configuration).sort()) output.line(`${key}=${value}`)
    output.line(`compose files: ${context.composeFiles.join(', ')}`)
  }
}

export async function statusCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const containers = await inspectContainers()
  const routes = routesFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http')
  const gateway = containers.filter((container) => container.labels['portta.managed'] === 'true')
  const status = {
    version: context.version,
    instance: { name: context.config.projectName },
    profile: context.config.profile,
    domain: context.config.domain,
    bindAddress: context.config.bindAddress,
    network: { name: context.config.network, exists: await networkExists(context.config.network) },
    components: gateway.map((container) => ({
      name: container.name,
      state: container.state,
      component: container.labels['portta.component'] ?? null,
    })),
    projectCount: projectsFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http').length,
    routeCount: routes.length,
    tls: context.config.tlsEnabled,
    public: context.config.publicEnabled,
  }
  const output = new Output(options)
  if (output.json) output.data(status)
  else {
    output.line(`portta ${status.version} · ${status.profile} · ${status.domain}`)
    output.line(
      `network ${status.network.exists ? 'ready' : 'missing'} · ${status.components.length} components · ${status.routeCount} routes`,
    )
    for (const component of status.components)
      output.line(`${component.component ?? component.name}\t${component.state}`)
  }
}

// `warn` comes from the shell doctor, which distinguishes "worth knowing"
// from "broken": an absent GitHub CLI is not a reason to fail a run.
export interface Check {
  id: string
  status: 'pass' | 'info' | 'warn' | 'fail'
  message: string
  fix?: string
}

/**
 * What `doctor` prints, as data.
 *
 * A fix belongs to a check that did not pass: printed under `ok` it reads as an
 * instruction to repair something that is already right.
 */
export function doctorReport(checks: Check[]): { line: string; hint?: string }[] {
  return checks.map((check) => ({
    line: `${check.status === 'pass' ? 'ok  ' : check.status === 'info' ? 'info' : check.status === 'warn' ? 'warn' : 'FAIL'} ${check.message}`,
    ...(check.fix && check.status !== 'pass' ? { hint: check.fix } : {}),
  }))
}

export async function doctorCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const checks: Check[] = (await runDoctor(context)).map((entry) => ({
    id: entry.id,
    status: entry.status,
    message: `${entry.title}: ${entry.detail}`,
    ...(entry.fix ? { fix: entry.fix } : {}),
  }))

  // A published CLI can be pointed at an installation whose overlay set
  // differs from the one it would choose.
  for (const file of context.composeFiles) {
    checks.push({
      id: `compose:${file}`,
      status: existsSync(join(context.root, file)) ? 'pass' : 'fail',
      message: `${file} exists`,
    })
  }

  // An alias pins a container name, so a recreated environment leaves a router
  // pointing at nothing. Traefik reports no error for that; this does.
  const aliases = readAliases(context.root)
  if (aliases.length > 0) {
    const running = new Set((await inspectContainers()).map((container) => container.name))
    const dangling = aliases.filter((alias) => !running.has(alias.container))
    checks.push(
      dangling.length === 0
        ? { id: 'aliases', status: 'pass', message: `${aliases.length} hostname alias(es) routed` }
        : {
            id: 'aliases',
            status: 'fail',
            message: `alias target missing: ${dangling.map((alias) => `${alias.host} -> ${alias.container}`).join(', ')}`,
            fix: 'remove the alias in the panel, or start the environment again',
          },
    )
  }

  const failed = checks.filter((entry) => entry.status === 'fail')
  const output = new Output(options)
  if (output.json) output.data({ ok: failed.length === 0, instance: { name: context.config.projectName }, checks })
  else
    for (const entry of doctorReport(checks)) {
      output.line(entry.line)
      if (entry.hint) output.hint(entry.hint)
    }
  if (failed.length) throw new CliError(`${failed.length} doctor check(s) failed`)
}

/**
 * Panel-created aliases live in a generated Traefik file, so the CLI can read
 * the same routing the panel wrote instead of disagreeing with it.
 */
export function readAliases(root: string): StoredAlias[] {
  const path = join(root, 'config/traefik/dynamic/portta-aliases.yaml')
  if (!existsSync(path)) return []
  try {
    return parseAliases(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

export async function urlsCommand(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const scheme = context.config.tlsEnabled ? 'https' : 'http'
  const derived = routesFor(await inspectContainers(), context.config.domain, scheme).map((route) => ({
    ...route,
    alias: false,
  }))
  const aliases = readAliases(context.root).map((alias) => ({
    project: alias.project,
    service: alias.service,
    container: alias.container,
    hostname: alias.host,
    url: `${scheme}://${alias.host}`,
    port: String(alias.port),
    state: 'alias',
    alias: true,
  }))
  const routes = [...derived, ...aliases]
    .filter((route) => !options.project || route.project === options.project)
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, routes })
  else
    for (const route of routes)
      output.line(
        `${route.url}\t${route.project ?? '-'}\t${route.service ?? route.container}${route.alias ? '\talias' : ''}`,
      )
}
