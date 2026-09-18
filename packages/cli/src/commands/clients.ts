import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Command } from 'commander'
import { databaseFileFor, databaseFiles, porttaImages } from 'portta-core'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { accessClose, accessOpen } from './access.js'
import { requestPanelMigrate } from './web.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

async function ensureToolbox(command: Command): Promise<string> {
  const context = gatewayContext({ profile: globals(command).profile })
  const image = porttaImages(context.version).toolbox
  const present = await runProcess('docker', ['image', 'inspect', image], { reject: false })
  if (present.exitCode === 0) return image
  await runProcess(
    'docker',
    [
      'build',
      '-q',
      '--build-arg',
      `PORTTA_VERSION=${context.version}`,
      '-t',
      image,
      join(context.root, 'docker', 'images', 'toolbox'),
    ],
    { stdio: 'inherit' },
  )
  return image
}

async function containerEnvironment(id: string): Promise<Record<string, string>> {
  const result = await runProcess('docker', [
    'inspect',
    id,
    '--format',
    '{{ range .Config.Env }}{{ println . }}{{ end }}',
  ])
  return Object.fromEntries(
    result.stdout
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
      .filter(([key]) => key),
  )
}

function defaultPort(image: string): number | null {
  if (/postgres|postgis|timescale/i.test(image)) return 5432
  if (/mysql|mariadb|percona/i.test(image)) return 3306
  if (/redis|valkey|keydb/i.test(image)) return 6379
  return null
}

export interface ClientOptions {
  project: string
  service: string
  port?: string
  user?: string
  database?: string
}
export async function clientExec(
  client: 'psql' | 'mysql' | 'redis-cli',
  options: ClientOptions,
  passthrough: string[],
  command: Command,
): Promise<void> {
  if (passthrough[0] === '--') passthrough = passthrough.slice(1)
  const context = gatewayContext({ profile: globals(command).profile })
  const containers = await inspectContainers(false)
  const target = containers.find(
    (container) =>
      container.labels['com.docker.compose.project'] === options.project &&
      container.labels['com.docker.compose.service'] === options.service,
  )
  if (!target) throw new UsageError(`no running container for ${options.project}/${options.service}`)
  const network = target.networks.find(
    (name) => ![context.config.network, context.config.accessNetwork, context.config.controlNetwork].includes(name),
  )
  if (!network) throw new PreconditionError(`${options.project}/${options.service} has no private network`)
  const port = Number(options.port ?? defaultPort(target.image))
  if (!port) throw new UsageError('cannot determine the service port', 'pass --port')
  const targetEnv = await containerEnvironment(target.id)
  const env: NodeJS.ProcessEnv = { ...process.env }
  const envArgs: string[] = []
  const args: string[] = [
    'run',
    '--rm',
    '-i',
    ...(process.stdin.isTTY && process.stdout.isTTY ? ['-t'] : []),
    '--network',
    network,
  ]
  if (client === 'psql' && targetEnv.POSTGRES_PASSWORD) {
    env.PGPASSWORD = targetEnv.POSTGRES_PASSWORD
    envArgs.push('-e', 'PGPASSWORD')
  }
  if (client === 'mysql' && targetEnv.MYSQL_PASSWORD) {
    env.MYSQL_PWD = targetEnv.MYSQL_PASSWORD
    envArgs.push('-e', 'MYSQL_PWD')
  }
  const toolbox = await ensureToolbox(command)
  args.push(...envArgs, toolbox, client)
  if (client === 'psql')
    args.push(
      '-h',
      options.service,
      '-p',
      String(port),
      ...((options.user ?? targetEnv.POSTGRES_USER) ? ['-U', options.user ?? targetEnv.POSTGRES_USER!] : []),
      ...((options.database ?? targetEnv.POSTGRES_DB) ? ['-d', options.database ?? targetEnv.POSTGRES_DB!] : []),
    )
  if (client === 'mysql')
    args.push(
      '-h',
      options.service,
      '-P',
      String(port),
      ...((options.user ?? targetEnv.MYSQL_USER) ? ['-u', options.user ?? targetEnv.MYSQL_USER!] : []),
      ...((options.database ?? targetEnv.MYSQL_DATABASE) ? [options.database ?? targetEnv.MYSQL_DATABASE!] : []),
    )
  if (client === 'redis-cli') args.push('-h', options.service, '-p', String(port))
  args.push(...passthrough)
  await runProcess('docker', args, { env, stdio: 'inherit' })
}

export async function dbOpen(
  options: { project: string; service?: string; port?: string; localPort?: string },
  command: Command,
): Promise<void> {
  await accessOpen(
    {
      project: options.project,
      service: options.service ?? 'postgres',
      port: options.port,
      localPort: options.localPort,
    },
    command,
  )
}
export async function redisOpen(
  options: { project: string; service?: string; port?: string; localPort?: string },
  command: Command,
): Promise<void> {
  await accessOpen(
    { project: options.project, service: options.service ?? 'redis', port: options.port, localPort: options.localPort },
    command,
  )
}
export async function clientClose(options: { project: string }, command: Command): Promise<void> {
  await accessClose(undefined, { project: options.project }, command)
}

export async function dbUrl(options: { project: string; service?: string }, command: Command): Promise<void> {
  const service = options.service ?? 'postgres'
  const bridge = (await inspectContainers()).find(
    (container) =>
      container.labels['portta.component'] === 'access-bridge' &&
      container.labels['portta.access.project'] === options.project &&
      container.labels['portta.access.service'] === service,
  )
  if (!bridge) throw new UsageError(`no bridge is open for ${options.project}/${service}`)
  const binding = bridge.ports.find((port) => port.publicPort !== null)
  if (!binding?.publicPort) throw new PreconditionError('bridge has no host port')
  const kind = bridge.labels['portta.access.kind']
  const url =
    kind === 'postgres'
      ? `postgresql://<user>@127.0.0.1:${binding.publicPort}/<database>`
      : kind === 'mysql'
        ? `mysql://<user>@127.0.0.1:${binding.publicPort}/<database>`
        : kind === 'redis'
          ? `redis://127.0.0.1:${binding.publicPort}`
          : `127.0.0.1:${binding.publicPort}`
  new Output(globals(command)).data(url)
}

/**
 * The panel's own database: one SQLite file on this host.
 *
 * Every verb below operates it directly. There is no container to enter, no
 * network to join, no credential to pass and no toolbox image to build — the
 * file is on this filesystem, and `portta` runs here
 * (docs/development/adr/0037-sqlite-is-the-panel-database.md). A dump is
 * `sqlite3 .backup`, or a copy when even that is unavailable.
 *
 * `clientExec` above is unrelated and unchanged: those are a *project's*
 * datastores, which are still containers on private networks.
 */
function panelDatabase(command: Command): { path: string; root: string } {
  const context = gatewayContext({ profile: globals(command).profile })
  return { path: databaseFileFor(context.root), root: context.root }
}

export async function dbMigrate(command: Command): Promise<void> {
  const result = await requestPanelMigrate(gatewayContext({ profile: globals(command).profile }))
  const output = new Output(globals(command))
  if (output.json) output.data(result)
  else if (result.applied.length === 0) output.line(`no pending migrations (${result.migrations.length} applied)`)
  else output.line(`applied ${result.applied.join(', ')}`)
}

export function dbStatus(command: Command): void {
  const { path } = panelDatabase(command)
  const files = databaseFiles(path).filter((candidate) => existsSync(candidate))
  const bytes = files.reduce((total, candidate) => total + statSync(candidate).size, 0)
  const result = {
    state: existsSync(path) ? 'ready' : 'absent',
    path,
    // All three, because a WAL database is three files and the one people look
    // at is the smallest of them right after a write.
    files: files.map((candidate) => basename(candidate)),
    bytes,
  }
  const output = new Output(globals(command))
  if (output.json) output.data(result)
  else
    output.line(`Panel database: ${result.state}\nFile: ${path}\nSize: ${bytes} bytes across ${files.length} file(s)`)
  if (result.state !== 'ready') {
    throw new PreconditionError(
      'the panel database does not exist yet',
      'run portta web up; the panel creates it on first boot',
    )
  }
}

/**
 * The `sqlite3` binary, or a refusal that says what to install.
 *
 * Not bundled and not replaced by the panel's own driver: `shell` and `dump`
 * are what somebody reaches for when the panel is *not* running, so they must
 * not need it. `sqlite3` ships with macOS and is one package everywhere else.
 */
async function sqlite3(): Promise<string> {
  const found = await runProcess('sh', ['-c', 'command -v sqlite3'], { reject: false })
  const path = found.stdout.trim()
  if (found.exitCode !== 0 || !path) {
    throw new PreconditionError(
      'sqlite3 is not installed on this host',
      'install it (macOS ships it; apt install sqlite3, apk add sqlite) and try again',
    )
  }
  return path
}

export async function dbShell(command: Command): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new PreconditionError('db shell needs an interactive terminal')
  const { path } = panelDatabase(command)
  if (!existsSync(path)) throw new PreconditionError(`no panel database at ${path}`, 'run portta web up')
  await runProcess(await sqlite3(), [path], { stdio: 'inherit' })
}

/**
 * A consistent copy, taken while the panel is running.
 *
 * `.backup` rather than `cat`: SQLite in WAL mode keeps recent writes in a
 * side file, so copying the main file alone produces a database missing
 * whatever happened most recently — the failure mode of a backup that looks
 * like it worked. `.backup` takes all three into one consistent file.
 */
export async function dbDump(file: string | undefined, command: Command): Promise<void> {
  const { path } = panelDatabase(command)
  if (!existsSync(path)) throw new PreconditionError(`no panel database at ${path}`, 'run portta web up')
  const destination = file ?? `portta-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`
  await runProcess(await sqlite3(), [path, `.backup '${destination.replaceAll("'", "''")}'`], { stdio: 'inherit' })
  new Output(globals(command)).progress(`panel database written to ${destination}`)
}

/**
 * Putting one back, with the panel stopped.
 *
 * Refused while the panel is running rather than attempted: replacing the file
 * under an open connection leaves the panel reading a database that no longer
 * exists, and the symptom appears minutes later as corruption rather than as
 * this refusal.
 */
export async function dbRestore(file: string, command: Command): Promise<void> {
  if (!existsSync(file)) throw new UsageError(`backup not found: ${file}`)
  const { path } = panelDatabase(command)
  const running = (await inspectContainers()).some(
    (container) => container.labels['portta.component'] === 'web' && container.state === 'running',
  )
  if (running) {
    throw new PreconditionError(
      'the panel is running, and replacing its database under it would corrupt what it has open',
      'portta web down   then run this again, then portta web up',
    )
  }
  await confirm(`replace ${path} with ${file}? The current panel data is discarded.`, globals(command).yes === true)
  mkdirSync(dirname(path), { recursive: true })
  // Every file, and in this order: the -wal and -shm belong to the database
  // being replaced, and leaving them beside a restored file is how SQLite
  // reads the old writes back over the new database.
  for (const candidate of databaseFiles(path)) rmSync(candidate, { force: true })
  copyFileSync(file, path)
  new Output(globals(command)).progress(`panel database restored from ${file}`)
}
