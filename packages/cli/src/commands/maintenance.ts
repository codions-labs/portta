// `portta backup`, `portta restore`, `portta repair`.
//
// The three operations that assume something has gone wrong, or is about to.
//
// What has to be preserved is decided by ADR 0020: everything under
// PORTTA_HOME is a bind mount and can simply be copied — including the panel's
// database, which is now a file there rather than a named volume
// (docs/development/adr/0037-sqlite-is-the-panel-database.md). It is still not
// *copied*: in WAL mode a database is three files, and taking only the first
// leaves out the most recent writes. SQLite writes one consistent file instead.

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { databaseFileFor, databaseFiles, isTrue } from 'portta-core'
import { composeArguments, type GatewayContext, gatewayContext } from '../context.js'
import { PreconditionError, UsageError } from '../errors.js'
import { fileMode } from '../host.js'
import { INSTALLATION_DIRECTORIES } from '../installation-directories.js'
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

/** The archive format written and read by this release. */
export const BACKUP_VERSION = 1

export interface BackupManifest {
  version: number
  portta: string
  created: string
  host: string
}

/**
 * What a backup contains, and deliberately not everything.
 *
 * Anything the installer can fetch again (`bin`, `scripts`, `docker/`) is left
 * out: including it would make the archive a stale copy of the release, and
 * restoring it onto a newer Portta would quietly downgrade the code while
 * claiming to restore data.
 */
export function backupPaths(root: string): string[] {
  return ['.env', 'VERSION', 'config', 'state'].filter((path) => existsSync(join(root, path)))
}

export function renderManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(manifest)}\n`
}

export function parseManifest(text: string): BackupManifest | null {
  try {
    const parsed = JSON.parse(text) as Partial<BackupManifest>
    if (
      parsed.version !== BACKUP_VERSION ||
      typeof parsed.portta !== 'string' ||
      typeof parsed.created !== 'string' ||
      typeof parsed.host !== 'string'
    )
      return null
    return parsed as BackupManifest
  } catch {
    return null
  }
}

async function containerRunning(name: string): Promise<boolean> {
  const result = await runProcess('docker', ['inspect', '-f', '{{.State.Running}}', name], { reject: false })
  return !result.failed && result.stdout.trim() === 'true'
}

/**
 * A consistent copy of the panel's database, taken while it runs.
 *
 * `VACUUM INTO` rather than a file copy: in WAL mode the most recent writes
 * live in a side file, so copying `portta.db` alone produces a database missing
 * them — a backup that looks like it worked. SQLite writes one complete file,
 * which is also why the archive holds a `.db` rather than the three files the
 * running database is.
 *
 * SQLite itself does this, so nothing here needs the panel to be up. That is
 * the point: a backup taken to recover from a panel that will not start is the
 * one a `docker exec` could never have taken
 * (docs/development/adr/0037-sqlite-is-the-panel-database.md).
 */
async function dumpDatabase(context: GatewayContext, target: string): Promise<boolean> {
  const source = databaseFileFor(context.root)
  if (!existsSync(source)) return false
  const sqlite = await runProcess('sh', ['-c', 'command -v sqlite3'], { reject: false })
  const binary = sqlite.stdout.trim()
  if (sqlite.failed || !binary) return false
  const copied = await runProcess(binary, [source, `VACUUM INTO '${target.replaceAll("'", "''")}'`], { reject: false })
  if (copied.failed || !existsSync(target)) return false
  chmodSync(target, 0o600)
  return true
}

export async function backupCommand(options: { output?: string; database?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  const target = options.output ?? join(context.root, `portta-backup-${stamp}.tar.gz`)

  // The staging area holds a copy of every secret in the installation.
  const staging = mkdtempSync(join(tmpdir(), 'portta-backup-'))
  chmodSync(staging, 0o700)
  try {
    writeFileSync(
      join(staging, 'portta-backup.json'),
      renderManifest({
        version: BACKUP_VERSION,
        portta: context.version,
        created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        host: hostname() || 'unknown',
      }),
    )

    const paths = backupPaths(context.root)
    for (const path of paths) {
      mkdirSync(join(staging, 'tree', dirname(path)), { recursive: true })
      cpSync(join(context.root, path), join(staging, 'tree', path), { recursive: true })
    }

    let database = false
    if (options.database !== false) {
      database = await dumpDatabase(context, join(staging, 'panel.db'))
      if (!database) {
        output.warning('the panel database was not included')
        output.hint(
          'it exists once the panel has started, and copying it needs sqlite3 on this host; --no-database silences this',
        )
      }
    }

    // A backup is a file full of credentials, so it is created with a private
    // umask rather than chmod'ed afterwards: it is never briefly world-readable.
    const previous = process.umask(0o077)
    let archived: Awaited<ReturnType<typeof runProcess>>
    try {
      archived = await runProcess('tar', ['-czf', target, '-C', staging, '.'], { reject: false })
    } finally {
      process.umask(previous)
    }
    if (archived.failed) throw new PreconditionError(`could not write ${target}`, archived.stderr.trim())

    const size = statSync(target).size
    if (output.json) {
      output.data({ file: target, size, paths, database })
      return
    }
    output.progress('backup written')
    output.line(`  file      ${target}`)
    output.line(`  size      ${humanSize(size)}`)
    output.line(`  contents  ${paths.length} path(s)${database ? ' + database' : ''}`)
    output.line('')
    output.warning('this archive contains credentials: .env, the panel password hash and any tokens')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function humanSize(bytes: number): string {
  const units = ['B', 'K', 'M', 'G', 'T']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`
}

export async function restoreCommand(
  archive: string | undefined,
  options: { force?: boolean },
  command: Command,
): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })

  if (!archive) throw new UsageError('which backup?', 'portta restore <file>')
  if (!existsSync(archive)) throw new UsageError(`no such file: ${archive}`)

  const staging = mkdtempSync(join(tmpdir(), 'portta-restore-'))
  chmodSync(staging, 0o700)
  try {
    const extracted = await runProcess('tar', ['-xzf', archive, '-C', staging], { reject: false })
    if (extracted.failed) throw new UsageError('that file is not a Portta backup')

    const manifestPath = join(staging, 'portta-backup.json')
    if (!existsSync(manifestPath)) throw new UsageError('that archive has no Portta manifest')
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
    if (!manifest) throw new UsageError('that archive has an unreadable Portta manifest')
    output.progress(`restoring a backup taken from Portta ${manifest.portta}`)

    // Refusing by default matters: restoring over a running installation
    // replaces its credentials, and the containers would keep running with the
    // old ones.
    if (!options.force && (await containerRunning(`${context.env.PORTTA_PROJECT_NAME || 'portta'}-traefik-1`))) {
      throw new PreconditionError(
        'the gateway is running',
        'portta down, then restore; or pass --force to replace configuration underneath it',
      )
    }

    // Whatever is being replaced is kept, because a restore that turns out to
    // be the wrong archive is otherwise unrecoverable.
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')
    const safety = join(context.root, 'state', `restore-${stamp}`)
    mkdirSync(safety, { recursive: true })
    for (const path of ['.env', 'config']) {
      if (existsSync(join(context.root, path))) {
        cpSync(join(context.root, path), join(safety, path), { recursive: true })
      }
    }
    output.progress(`kept what was there under ${safety}`)

    const tree = join(staging, 'tree')
    if (existsSync(tree)) {
      for (const path of backupPaths(tree)) {
        cpSync(join(tree, path), join(context.root, path), { recursive: true, force: true })
      }
      output.progress('configuration and state restored')
    }
    if (existsSync(join(context.root, '.env'))) chmodSync(join(context.root, '.env'), 0o600)

    const dump = join(staging, 'panel.db')
    if (existsSync(dump)) {
      // Refused rather than attempted while the panel holds the file open:
      // replacing it underneath an open connection surfaces as corruption
      // minutes later rather than as this message.
      const panelUp = await containerRunning(`${context.env.PORTTA_PROJECT_NAME || 'portta'}-web-1`)
      const target = databaseFileFor(context.root)
      if (panelUp) {
        output.warning('the panel is running, so its database was not replaced')
        output.hint(`portta web down   then: portta restore ${archive} --force`)
      } else {
        mkdirSync(dirname(target), { recursive: true })
        // Every file, and in this order: a `-wal` left beside a restored
        // database is how SQLite reads the old writes back over the new one.
        for (const file of databaseFiles(target)) rmSync(file, { force: true })
        copyFileSync(dump, target)
        chmodSync(target, 0o600)
        output.progress('panel database restored')
      }
    }

    output.line('')
    output.progress('restore complete')
    output.hint('portta up   then   portta doctor')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Things that hold secrets, and the mode that makes them not a finding. */
export const REPAIR_MODES: Array<{ path: string; mode: number }> = [
  { path: '.env', mode: 0o600 },
  { path: 'state/traefik/acme', mode: 0o700 },
  { path: 'state/traefik/acme/acme.json', mode: 0o600 },
  { path: 'state/cloudflared', mode: 0o700 },
  { path: 'state/cloudflared/credentials.json', mode: 0o600 },
  { path: 'state/runner', mode: 0o700 },
  { path: 'state/ssh', mode: 0o700 },
  { path: 'state/auth', mode: 0o700 },
]

/**
 * Everything repair does is idempotent and additive. It never deletes data,
 * never touches a volume and never rewrites a value somebody chose: it
 * recreates what is missing and fixes what is provably wrong, which is the
 * difference between a repair and a reinstall.
 */
export async function repairCommand(options: { dryRun?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const dry = options.dryRun ?? false
  const changes: string[] = []

  output.progress('Repair')

  for (const { path, mode } of INSTALLATION_DIRECTORIES) {
    const full = join(context.root, path)
    if (existsSync(full)) continue
    changes.push(`create ${path}`)
    if (dry) {
      output.line(`   would create ${path}`)
      continue
    }
    mkdirSync(full, { recursive: true })
    chmodSync(full, mode)
    output.progress(`created ${path}`)
  }

  for (const { path, mode } of REPAIR_MODES) {
    const full = join(context.root, path)
    if (!existsSync(full)) continue
    const have = fileMode(full)
    const want = mode.toString(8)
    if (!have || have === want) continue
    changes.push(`chmod ${path} ${want}`)
    if (dry) {
      output.line(`   would change ${path} from ${have} to ${want}`)
      continue
    }
    chmodSync(full, mode)
    output.progress(`${path} is now ${want} (was ${have})`)
  }

  // The shared network is external and outlives the stack, so a housekeeping
  // sweep on the host can remove it and nothing brings it back. The gateway
  // itself never prunes anything; maintenance tests enforce that.
  const networks = [context.env.PORTTA_NETWORK || 'portta']
  // The access network carries TCP services and is absent by design when they
  // are off. Demanding it on every host would report a repair that is not one.
  if (isTrue(context.env.PORTTA_TCP)) networks.push(context.env.PORTTA_ACCESS_NETWORK || 'portta-access')
  for (const network of networks) {
    const exists = await runProcess('docker', ['network', 'inspect', network], { reject: false })
    if (!exists.failed) continue
    changes.push(`create network ${network}`)
    if (dry) {
      output.line(`   would create network ${network}`)
      continue
    }
    const created = await runProcess('docker', ['network', 'create', '--label', 'portta.managed=true', network], {
      reject: false,
    })
    if (created.failed) output.warning(`could not create network ${network}`)
    else output.progress(`created network ${network}`)
  }

  if (dry) {
    output.line('')
    if (output.json) {
      output.data({ dryRun: true, changes })
      return
    }
    output.progress(changes.length === 0 ? 'nothing to repair' : `${changes.length} thing(s) would be repaired`)
    return
  }

  // `up -d` is idempotent: containers whose definition has not changed are
  // left alone, so this is safe to run on a healthy installation.
  output.progress('reconciling containers')
  const up = await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--remove-orphans'], {
    cwd: context.root,
    env: context.env as NodeJS.ProcessEnv,
    stdio: 'inherit',
    reject: false,
  })
  if (up.failed) throw new PreconditionError('the gateway did not come up', 'portta doctor')

  output.line('')
  if (output.json) {
    output.data({ dryRun: false, changes })
    return
  }
  output.progress(
    changes.length === 0
      ? 'nothing needed repairing; containers reconciled'
      : `${changes.length} thing(s) repaired; containers reconciled`,
  )
  output.hint('portta doctor   confirms the result')
}
