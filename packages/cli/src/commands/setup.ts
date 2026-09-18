import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { prepareEnvFile } from 'portta-core'
import { confirm } from '../confirm.js'
import { composeArguments, findGatewayRoot, gatewayContext } from '../context.js'
import { ensureNetwork, requireDocker } from '../docker.js'
import { PreconditionError, RefusedError } from '../errors.js'
import { ensureInstallationDirectories } from '../installation-directories.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { CORPUS_FILE } from './docs.js'

interface SetupOptions {
  dir?: string
  profile?: string
  dryRun?: boolean
  skipPull?: boolean
}
interface SetupStep {
  step: string
  status: 'ok' | 'created' | 'updated' | 'skipped' | 'planned'
  detail: string
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
function major(version: string): number {
  return Number(/^v?(\d+)/.exec(version)?.[1] ?? 0)
}

async function available(file: string, args: string[]): Promise<{ ok: boolean; value: string }> {
  const result = await runProcess(file, args, { reject: false })
  return { ok: result.exitCode === 0, value: result.stdout.trim() }
}

function packagedRuntime(): string {
  const explicit = process.env.PORTTA_RUNTIME_ROOT
  if (explicit) return resolve(explicit)
  const candidates = [join(import.meta.dirname, 'runtime'), join(import.meta.dirname, '..', 'runtime')]
  const found = candidates.find((candidate) => existsSync(join(candidate, 'VERSION')))
  if (!found)
    throw new PreconditionError(
      'the Portta package does not contain its runtime assets',
      'reinstall the `@codions/portta` npm package',
    )
  return found
}

function installRuntime(source: string, target: string): void {
  mkdirSync(target, { recursive: true })
  const cache = join(target, 'runtime')
  const sameCache = existsSync(cache) && realpathSync(source) === realpathSync(cache)
  if (!sameCache) {
    rmSync(cache, { recursive: true, force: true })
    cpSync(source, cache, { recursive: true, force: true })
  }
  for (const entry of readdirSync(source)) {
    if (entry === 'config') continue
    const destination = join(target, entry)
    rmSync(destination, { recursive: true, force: true })
    cpSync(join(source, entry), destination, { recursive: true, force: true })
  }
  const defaults = join(source, 'config', 'traefik', 'dynamic')
  const dynamic = join(target, 'config', 'traefik', 'dynamic')
  mkdirSync(dynamic, { recursive: true })
  for (const entry of readdirSync(defaults)) {
    const destination = join(dynamic, entry)
    if (!existsSync(destination)) copyFileSync(join(defaults, entry), destination)
  }
  // The applier container runs `node <root>/bin/portta up` with only `<root>`
  // mounted, so everything that entry point loads has to be inside it. The
  // bundle is split across chunks that `cli.js` imports by relative path, so
  // the whole directory travels, not just the entry file.
  const bin = join(target, 'bin')
  mkdirSync(bin, { recursive: true })
  const bundle = import.meta.dirname
  const executable = fileURLToPath(import.meta.url)
  const installed = join(bin, 'portta')
  if (resolve(executable) !== resolve(bundle)) {
    for (const entry of readdirSync(bundle).filter((name) => name.endsWith('.js')))
      copyFileSync(join(bundle, entry), join(bin, entry))
    // `portta` has no extension, and the chunks beside it are ESM. Node infers
    // that from syntax, but saying it here leaves nothing to infer.
    writeFileSync(join(bin, 'package.json'), '{ "type": "module" }\n')
    copyFileSync(join(bundle, 'cli.js'), installed)
  }
  chmodSync(installed, 0o755)
  const docs = join(bundle, CORPUS_FILE)
  if (existsSync(docs)) copyFileSync(docs, join(bin, CORPUS_FILE))
}

export async function setupCommand(options: SetupOptions, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  if (process.platform === 'win32') throw new PreconditionError('setup requires a POSIX host')
  const currentRoot = findGatewayRoot()
  const target = resolve(options.dir ?? currentRoot ?? join(homedir(), 'portta'))
  const profile = options.profile ?? global.profile ?? 'local'
  const runtime = packagedRuntime()
  const steps: SetupStep[] = []
  const record = (step: string, status: SetupStep['status'], detail: string) => {
    steps.push({ step, status, detail })
    if (!output.json) output.progress(`${status.padEnd(8)} ${detail}`)
  }

  const nodeVersion = process.versions.node
  if (major(nodeVersion) < 24)
    throw new PreconditionError(`Node ${nodeVersion} is too old`, 'Node 24 or newer is required')
  record('node', 'ok', `Node ${nodeVersion}`)
  await requireDocker()
  const docker = await available('docker', ['version', '--format', '{{.Server.Version}}'])
  if (!docker.ok || major(docker.value) < 24)
    throw new PreconditionError(
      'Docker Engine 24 or newer is required',
      'setup never installs Docker or invokes a system package manager',
    )
  const compose = await available('docker', ['compose', 'version', '--short'])
  if (!compose.ok || major(compose.value) < 2) throw new PreconditionError('Docker Compose v2 is required')
  record('docker', 'ok', `Docker ${docker.value}, Compose ${compose.value}`)

  if (options.dryRun) {
    record('runtime', 'planned', `install packaged runtime in ${target}`)
    record('environment', 'planned', `prepare .env from .env.example in ${target}, keeping set values`)
    record('network', 'planned', 'ensure the shared gateway network')
    record('gateway', 'planned', `pull pinned images and start profile ${profile}`)
    if (output.json) output.data({ dryRun: true, target, steps })
    return
  }

  await confirm(`set up Portta in ${target}?`, global.yes === true)
  if (
    existsSync(target) &&
    readdirSync(target).length > 0 &&
    !existsSync(join(target, 'docker', 'compose', 'compose.yaml'))
  ) {
    throw new RefusedError(
      `${target} exists and is not a Portta installation`,
      'choose an empty --dir; setup never overwrites an unrelated directory',
    )
  }
  mkdirSync(dirname(target), { recursive: true })
  const updating = existsSync(join(target, 'VERSION'))
  installRuntime(runtime, target)
  record('runtime', updating ? 'updated' : 'created', `${target}`)

  const envFile = join(target, '.env')
  prepareEnvFile(envFile)
  record('environment', 'updated', 'environment prepared from .env.example')
  ensureInstallationDirectories(target)
  record('directories', 'ok', 'gateway state directories')
  const context = gatewayContext({ root: target, profile })
  const network = await ensureNetwork(context.config.network)
  record('network', network, `shared network ${context.config.network}`)
  if (options.skipPull) record('images', 'skipped', 'image pull disabled')
  else {
    await runProcess('docker', ['compose', ...composeArguments(context), 'pull', '--ignore-buildable'], {
      cwd: target,
      env: context.env,
    })
    record('images', 'ok', 'pinned images pulled')
  }
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--wait', '--wait-timeout', '180'], {
    cwd: target,
    env: context.env,
  })
  record('gateway', 'ok', `gateway up on ${profile}`)
  const running = await runProcess(
    'docker',
    ['compose', ...composeArguments(context), 'ps', '--status', 'running', '--quiet'],
    { cwd: target, env: context.env },
  )
  if (!running.stdout.trim())
    throw new PreconditionError(
      'gateway started but no component remained running',
      `run portta doctor inside ${target}`,
    )
  record('doctor', 'ok', 'gateway components are running')
  if (output.json) {
    output.data({ dryRun: false, target, steps })
    return
  }
  output.progress('')
  output.progress(`Portta is installed in ${target}.`)
  if (resolve(target) !== resolve(join(homedir(), 'portta')))
    output.progress(`Run portta from anywhere with PORTTA_HOME=${target} exported, or from inside that directory.`)
  output.progress(`The panel is off by default: portta web up starts it on http://127.0.0.1:${context.config.webPort}`)
  output.progress('portta doctor checks the installation.')
}
