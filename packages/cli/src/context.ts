import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  composeFiles,
  type GatewayConfig,
  loadGatewayConfig,
  mergeEnvironment,
  parseEnv,
  resolveDatabase,
} from 'portta-core'
import { PreconditionError } from './errors.js'
import { CLI_VERSION } from './version.js'

export interface GatewayContext {
  root: string
  env: NodeJS.ProcessEnv
  config: GatewayConfig
  composeFiles: string[]
  version: string
}

// A source checkout's local build identity. Never a real release: the
// package manifest's version is reserved for npm publication and is bumped
// only by CI, after `npm ci` already succeeded (see
// .github/workflows/publish.yaml and tooling/prepare-publication.mjs).
// Reusing it locally would make a dev build indistinguishable from a release.
export const LOCAL_DEV_VERSION = '0.0.0-local'

function isGatewayRoot(path: string): boolean {
  if (!existsSync(join(path, 'docker', 'compose', 'compose.yaml'))) return false
  // Installed runtimes always contain the generated VERSION file. A source
  // checkout intentionally does not: its package manifest only signals "this
  // is a checkout", not a version to build with.
  return existsSync(join(path, 'VERSION')) || existsSync(join(path, 'packages', 'cli', 'package.json'))
}

export function versionForRoot(root: string): string {
  const generated = join(root, 'VERSION')
  if (existsSync(generated)) return readFileSync(generated, 'utf8').trim()
  const manifest = join(root, 'packages', 'cli', 'package.json')
  if (existsSync(manifest)) return LOCAL_DEV_VERSION
  throw new PreconditionError(`missing generated VERSION in ${root}`, 'reinstall the @codions/portta npm package')
}

/**
 * Where an installation lives: PORTTA_HOME when set, then `~/portta` (what
 * `portta setup` installs into unless told otherwise), then the system-wide
 * locations. `portta` is meant to be run from anywhere on an installed host,
 * and walking up from the current directory only finds a checkout somebody
 * is standing in.
 */
function wellKnownRoots(): string[] {
  const home = process.env.HOME
  return [
    process.env.PORTTA_HOME,
    home ? join(home, 'portta') : undefined,
    '/opt/portta',
    home ? join(home, '.portta') : undefined,
    '/var/lib/portta',
  ].filter((path): path is string => Boolean(path))
}

export function findGatewayRoot(start = process.cwd()): string | null {
  const configured = process.env.PORTTA_ROOT
  if (configured && isGatewayRoot(resolve(configured))) return resolve(configured)
  let current = resolve(start)
  for (;;) {
    if (isGatewayRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  // Only once the walk found nothing: a checkout you are standing in always
  // wins over an installation elsewhere on the host.
  for (const candidate of wellKnownRoots()) {
    if (isGatewayRoot(resolve(candidate))) return resolve(candidate)
  }
  return null
}

/** Explicit operational overrides select services for commands such as web down.
 * Persistent installation values always win over inherited shell variables. */
export function gatewayContext(
  options: { root?: string; profile?: string; required?: boolean; overrides?: Record<string, string> } = {},
): GatewayContext {
  const root = options.root ? resolve(options.root) : findGatewayRoot()
  if (!root) {
    if (options.required === false) {
      const env = { ...process.env, PORTTA_PROFILE: options.profile ?? process.env.PORTTA_PROFILE }
      const config = loadGatewayConfig(env)
      return { root: process.cwd(), env, config, composeFiles: [], version: CLI_VERSION }
    }
    throw new PreconditionError(
      'no Portta installation found',
      'run `portta setup`, set PORTTA_HOME, or run this inside the gateway directory',
    )
  }
  const file = existsSync(join(root, '.env'))
    ? parseEnv(readFileSync(join(root, '.env'), 'utf8'))
    : new Map<string, string>()
  const env = mergeEnvironment(file, process.env)
  for (const [key, value] of Object.entries(options.overrides ?? {})) env[key] = value
  if (options.profile) env.PORTTA_PROFILE = options.profile
  env.PORTTA_ROOT = root
  resolveDatabase(env)
  const config = loadGatewayConfig(env)
  // The resolved values go back into the environment Compose is handed, the
  // same way portta_resolve_profile exports them. Traefik bakes PORTTA_DOMAIN
  // into its default rule and publishes PORTTA_BIND_ADDRESS, and both are
  // derived here — from the domain mode and from the profile — so leaving the
  // raw .env values in place would start a gateway that disagrees with every
  // command that describes it.
  env.PORTTA_DOMAIN = config.domain
  env.PORTTA_BIND_ADDRESS = config.bindAddress
  const files = composeFiles(config)
  for (const fileName of files) {
    if (!existsSync(join(root, fileName))) throw new PreconditionError(`missing compose file: ${fileName}`)
  }
  const version = versionForRoot(root)
  env.PORTTA_VERSION = version
  return {
    root,
    env,
    config,
    composeFiles: files,
    version,
  }
}

// --project-directory anchors every relative path in the overlays (./config,
// ./state, ./.env, and the build contexts) at the repository root. Without it
// Compose would resolve them against docker/compose/, where the first -f file lives.
export function composeArguments(context: GatewayContext): string[] {
  return [
    '--project-directory',
    context.root,
    ...context.composeFiles.flatMap((file) => ['-f', join(context.root, file)]),
  ]
}
