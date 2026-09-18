// `portta host service`: the host daemon as a user service, so it survives a
// logout and a reboot without a terminal holding `portta host serve`.
//
// One service per machine, `portta-host`: a systemd user unit on Linux and a
// launchd agent on macOS. The unit runs `portta host serve` from the
// installation, so the daemon reads the same `.env` a foreground start does;
// only the variables a service manager would otherwise lose (PATH, and secrets
// such as LINEAR_API_KEY that live in a shell profile) are written into it.

import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { SERVICE_IDENTITY } from 'portta-core/taskflow/config'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { CliError, PreconditionError, UsageError } from '../errors.js'
import { locate } from '../host.js'
import { Output } from '../output.js'
import { runForeground, runProcess } from '../process.js'

export type Platform = 'linux' | 'darwin'
type ServiceCommand = [bin: string, args: string[]]

export const SERVICE_ACTIONS = ['install', 'uninstall', 'restart', 'status', 'logs'] as const
export type ServiceAction = (typeof SERVICE_ACTIONS)[number]

export interface ServiceConfig {
  platform: Platform
  /** The `portta` executable the unit starts. */
  porttaPath: string
  /** The installation the daemon serves, as `PORTTA_ROOT`. */
  root: string
  /** Extra environment written into the unit. PATH and PORTTA_ROOT are the generator's. */
  envVars: Record<string, string>
}

/** Variables worth carrying from the installing shell: credentials people export in a profile. */
export const AUTO_PICKUP_ENV_VARS = ['LINEAR_API_KEY'] as const

/** Names the generator writes itself and refuses from `--env`. */
const RESERVED_ENV_KEYS = new Set(['PATH', 'PORTTA_ROOT'])

function logFile(): string {
  return join(homedir(), 'Library', 'Logs', SERVICE_IDENTITY.logFile)
}

export function serviceFilePath(platform: Platform, home = homedir()): string {
  return platform === 'linux'
    ? join(home, '.config', 'systemd', 'user', `${SERVICE_IDENTITY.name}.service`)
    : join(home, 'Library', 'LaunchAgents', `${SERVICE_IDENTITY.launchdLabel}.plist`)
}

function escapePlistText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapePlistText(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** Every variable the unit sets, sorted so a reinstall writes the same file. */
function unitEnvironment(config: ServiceConfig): Array<[string, string]> {
  const extra = Object.keys(config.envVars)
    .sort()
    .map((key): [string, string] => [key, config.envVars[key] ?? ''])
  return [['PORTTA_ROOT', config.root], ['PATH', process.env.PATH ?? ''], ...extra]
}

export function generateServiceFile(config: ServiceConfig): string {
  const environment = unitEnvironment(config)
  if (config.platform === 'linux') {
    return `[Unit]
Description=${SERVICE_IDENTITY.description}

[Service]
Type=simple
ExecStart=${config.porttaPath} host serve
WorkingDirectory=${config.root}
Restart=on-failure
RestartSec=5
${environment.map(([key, value]) => `Environment=${key}=${value}`).join('\n')}

[Install]
WantedBy=default.target
`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_IDENTITY.launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapePlistText(config.porttaPath)}</string>
    <string>host</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapePlistText(config.root)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logFile()}</string>
  <key>StandardErrorPath</key>
  <string>${logFile()}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environment.map(([key, value]) => `    <key>${escapePlistText(key)}</key>\n    <string>${escapePlistText(value)}</string>`).join('\n')}
  </dict>
</dict>
</plist>
`
}

const SYSTEMD_ENV_RE = /^Environment=([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm
const LAUNCHD_ENV_DICT_RE = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/
const LAUNCHD_ENV_ENTRY_RE = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g

/** The variables a person added to an installed unit, without the generator's own. */
export function readEnvVarsFromUnit(filePath: string, platform: Platform): Record<string, string> {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  if (platform === 'linux') {
    for (const [, key, value] of text.matchAll(SYSTEMD_ENV_RE)) {
      if (key === undefined || value === undefined || RESERVED_ENV_KEYS.has(key)) continue
      out[key] = value
    }
    return out
  }
  const dict = LAUNCHD_ENV_DICT_RE.exec(text)?.[1] ?? ''
  for (const [, rawKey, rawValue] of dict.matchAll(LAUNCHD_ENV_ENTRY_RE)) {
    if (rawKey === undefined || rawValue === undefined) continue
    const key = unescapePlistText(rawKey)
    if (!RESERVED_ENV_KEYS.has(key)) out[key] = unescapePlistText(rawValue)
  }
  return out
}

/**
 * The unit's variables, later sources winning: what the installed unit already
 * has, then what the shell exports (unless `--no-auto-env`), then `--env`. The
 * notes say where each came from, for the plan shown before installing.
 */
export function resolveEnvVars(opts: {
  cliEnv: Record<string, string>
  processEnv: Record<string, string | undefined>
  existing: Record<string, string>
  autoPickup: boolean
}): { envVars: Record<string, string>; notes: string[] } {
  const envVars: Record<string, string> = { ...opts.existing }
  const notes = Object.keys(opts.existing)
    .sort()
    .map((key) => `  ${key}  (kept from the installed unit)`)
  if (opts.autoPickup) {
    for (const key of AUTO_PICKUP_ENV_VARS) {
      const value = opts.processEnv[key]
      if (value === undefined || value === '') continue
      notes.push(
        `  ${key}  (${envVars[key] === undefined ? 'from the shell' : 'from the shell, replacing the installed value'})`,
      )
      envVars[key] = value
    }
  }
  for (const [key, value] of Object.entries(opts.cliEnv)) {
    notes.push(`  ${key}  (${envVars[key] === undefined ? 'from --env' : 'from --env, replacing the previous value'})`)
    envVars[key] = value
  }
  return { envVars, notes }
}

/** Repeated `--env KEY=VALUE`, split on the first `=` so a value may contain one. */
export function parseEnvCliArgs(values: readonly string[]): { envVars: Record<string, string>; errors: string[] } {
  const envVars: Record<string, string> = {}
  const errors: string[] = []
  for (const raw of values) {
    const eq = raw.indexOf('=')
    const key = raw.slice(0, eq)
    if (eq <= 0) errors.push(`--env expects KEY=VALUE (got: ${raw})`)
    else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`--env key is not a valid identifier: ${key}`)
    else if (RESERVED_ENV_KEYS.has(key)) errors.push(`--env cannot set ${key}: the service unit manages it`)
    else envVars[key] = raw.slice(eq + 1)
  }
  return { envVars, errors }
}

/** The unit as shown before installing, with secret-looking values masked. */
export function redactUnit(content: string, envVars: Record<string, string>): string {
  let out = content
  for (const [key, value] of Object.entries(envVars)) {
    if (value && /(?:TOKEN|KEY|PASSWORD|SECRET)$/i.test(key)) out = out.split(value).join(`••• (${value.length} chars)`)
  }
  return out
}

function launchdTarget(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  return `gui/${uid}/${SERVICE_IDENTITY.launchdLabel}`
}

export function serviceCommands(
  action: Exclude<ServiceAction, 'logs'>,
  platform: Platform,
  filePath = serviceFilePath(platform),
): ServiceCommand[] {
  const name = SERVICE_IDENTITY.name
  if (platform === 'linux') {
    switch (action) {
      case 'install':
        return [
          ['systemctl', ['--user', 'daemon-reload']],
          ['systemctl', ['--user', 'enable', '--now', name]],
        ]
      case 'uninstall':
        return [
          ['systemctl', ['--user', 'stop', name]],
          ['systemctl', ['--user', 'disable', name]],
        ]
      case 'restart':
        return [['systemctl', ['--user', 'restart', name]]]
      case 'status':
        return [['systemctl', ['--user', 'status', name, '--no-pager']]]
    }
  }
  switch (action) {
    case 'install':
      return [['launchctl', ['load', '-w', filePath]]]
    case 'uninstall':
      return [['launchctl', ['unload', '-w', filePath]]]
    case 'restart':
      return [['launchctl', ['kickstart', '-k', launchdTarget()]]]
    case 'status':
      return [['launchctl', ['list', SERVICE_IDENTITY.launchdLabel]]]
  }
}

function formatCommand([bin, args]: ServiceCommand): string {
  return [bin, ...args].join(' ')
}

function platformOf(): Platform {
  if (process.platform === 'linux' || process.platform === 'darwin') return process.platform
  throw new PreconditionError(
    `the host service is not supported on ${process.platform}`,
    'run `portta host serve` under your own supervisor',
  )
}

/** The `portta` the unit starts: the one on PATH, else the script running now. */
async function porttaExecutable(): Promise<string> {
  const onPath = await locate('portta')
  if (onPath) return onPath
  const script = process.argv[1]
  if (!script)
    throw new PreconditionError('could not find the portta executable', 'install the CLI so `portta` is on PATH')
  return realpathSync(script)
}

async function runAll(commands: ServiceCommand[], output: Output, tolerateFailure = false): Promise<void> {
  for (const command of commands) {
    const result = await runProcess(command[0], command[1], { reject: false })
    if (result.failed && !tolerateFailure)
      throw new CliError(`${formatCommand(command)} failed`, 1, result.stderr.trim() || undefined)
    output.progress(`$ ${formatCommand(command)}`)
  }
}

interface ServiceOptions {
  json?: boolean
  yes?: boolean
  quiet?: boolean
  verbose?: boolean
  profile?: string
  env?: string[]
  autoEnv?: boolean
}

export async function hostService(action: ServiceAction, command: Command): Promise<void> {
  const options = command.optsWithGlobals() as ServiceOptions
  const output = new Output(options)
  const platform = platformOf()
  const filePath = serviceFilePath(platform)
  const installed = existsSync(filePath)

  if (action === 'install') {
    const cliEnv = parseEnvCliArgs(options.env ?? [])
    if (cliEnv.errors.length > 0) throw new UsageError(cliEnv.errors.join('; '))
    const context = gatewayContext({ profile: options.profile })
    const { envVars, notes } = resolveEnvVars({
      cliEnv: cliEnv.envVars,
      processEnv: process.env,
      existing: installed ? readEnvVarsFromUnit(filePath, platform) : {},
      autoPickup: options.autoEnv !== false,
    })
    const config: ServiceConfig = { platform, porttaPath: await porttaExecutable(), root: context.root, envVars }
    const content = generateServiceFile(config)
    output.progress(`${installed ? 'reinstalling' : 'installing'} ${filePath}`)
    output.detail(redactUnit(content, envVars))
    if (notes.length > 0) output.progress(`environment written into the unit:\n${notes.join('\n')}`)
    await confirm(`${installed ? 'Reinstall' : 'Install'} the ${SERVICE_IDENTITY.name} service?`, Boolean(options.yes))
    if (installed) await runAll(serviceCommands('uninstall', platform, filePath), output, true)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
    // Secrets may be in it; only the installing user reads it.
    if (Object.keys(envVars).length > 0) chmodSync(filePath, 0o600)
    await runAll(serviceCommands('install', platform, filePath), output)
    if (output.json) output.data({ installed: true, file: filePath })
    else output.progress(`${SERVICE_IDENTITY.name} installed and started; \`portta host service logs\` follows it`)
    if (platform === 'linux') output.hint('to keep it running after logout: loginctl enable-linger $USER')
    return
  }

  if (!installed)
    throw new PreconditionError(`the ${SERVICE_IDENTITY.name} service is not installed`, 'portta host service install')

  switch (action) {
    case 'uninstall':
      await confirm(`Uninstall the ${SERVICE_IDENTITY.name} service?`, Boolean(options.yes))
      await runAll(serviceCommands('uninstall', platform, filePath), output, true)
      unlinkSync(filePath)
      if (output.json) output.data({ installed: false, file: filePath })
      else output.progress(`removed ${filePath}`)
      return
    case 'restart':
      await runAll(serviceCommands('restart', platform, filePath), output)
      return
    case 'status': {
      const [status] = serviceCommands('status', platform, filePath)
      if (!status) return
      const result = await runProcess(status[0], status[1], { reject: false })
      if (output.json) output.data({ installed: true, file: filePath, running: !result.failed })
      else output.line((result.stdout || result.stderr).trimEnd())
      return
    }
    case 'logs': {
      const code =
        platform === 'linux'
          ? await runForeground('journalctl', ['--user', '-u', SERVICE_IDENTITY.name, '-f', '--no-pager'])
          : existsSync(logFile())
            ? await runForeground('tail', ['-f', logFile()])
            : 1
      if (code !== 0) throw new CliError(`could not follow the ${SERVICE_IDENTITY.name} logs`)
    }
  }
}
