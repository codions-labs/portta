// The demonstration stacks in Projects Home, and the checkout's own owner.
//
// `--demo` on up/dev/down starts and stops the `portta-demo-*` Compose
// projects, and registers each example's Project in the panel so the
// environments it starts belong to something; `reset` always stops them and
// drops their volumes first.
// Development runs also create the well-known checkout owner, so a fresh
// checkout has somebody to sign in as.
//
// Portta seeds no work: an issue lives in GitHub or in Linear, and a
// demonstration points at real ones rather than inventing local rows. The
// manifest's `project` block is the only part of it read here
// (docs/development/adr/0050-work-lives-in-an-external-provider.md).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Command } from 'commander'
import { DEV_DEMO_OWNER, defaultProjectsHome, normalizeProjectsHome } from 'portta-core'
import { gatewayContext } from '../context.js'
import { PreconditionError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { clientFor, workGlobals } from './work.js'

const PORTTA_DIRECTORY = '.portta'
const OVERLAY_FILE = 'compose.portta.yaml'
const COMPOSE_FILE = 'compose.yaml'
const PANEL_WAIT_MS = 120_000
const PANEL_POLL_MS = 500
const DEMO_DIRECTORY_PREFIX = 'portta-demo-'
const MANIFEST_FILE = 'portta.example.json'

export interface DemoStack {
  name: string
  dir: string
  files: string[]
  overlay: boolean
}

function demoDirectories(home: string): string[] {
  if (!existsSync(home)) return []
  return readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(DEMO_DIRECTORY_PREFIX))
    .map((entry) => join(home, entry.name))
    .sort()
}

export function findDemoStacks(home: string): DemoStack[] {
  return demoDirectories(home)
    .map((stackDir) => {
      if (!existsSync(join(stackDir, COMPOSE_FILE))) return null
      const localOverlay = join(PORTTA_DIRECTORY, OVERLAY_FILE)
      const overlay = existsSync(join(stackDir, localOverlay)) || existsSync(join(stackDir, OVERLAY_FILE))
      return {
        name: basename(stackDir),
        dir: stackDir,
        files: overlay
          ? [COMPOSE_FILE, existsSync(join(stackDir, localOverlay)) ? localOverlay : OVERLAY_FILE]
          : [COMPOSE_FILE],
        overlay,
      }
    })
    .filter((stack): stack is DemoStack => stack !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function demoComposeArgs(stack: DemoStack, action: 'up' | 'down'): string[] {
  const files = stack.files.flatMap((file) => ['-f', file])
  if (action === 'up') return ['compose', ...files, 'up', '-d']
  return ['compose', ...files, 'down', '-v']
}

export interface DemoRepository {
  name: string
  role: string | null
  relativePath: string
}

export interface DemoProject {
  slug: string
  name: string
  description: string | null
  relativePath: string
  repositories: DemoRepository[]
}

/**
 * The Project an example repository declares in `.portta/portta.example.json`.
 *
 * Only `project` and the repositories' names, roles and places are read. A
 * manifest without a Project, or one that is not JSON, is an example that
 * simply has none, never a reason to stop the demo.
 */
export function readDemoProject(stackDir: string): DemoProject | null {
  const path = join(stackDir, PORTTA_DIRECTORY, MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      project?: Record<string, unknown>
      repositories?: unknown
    }
    const project = manifest.project
    if (typeof project?.slug !== 'string' || typeof project.name !== 'string') return null
    const repositories = (
      Array.isArray(manifest.repositories) ? (manifest.repositories as Record<string, unknown>[]) : []
    )
      .filter((repository) => typeof repository?.name === 'string' && typeof repository.relativePath === 'string')
      .map((repository) => ({
        name: repository.name as string,
        role: typeof repository.role === 'string' ? repository.role : null,
        relativePath: repository.relativePath as string,
      }))
    return {
      slug: project.slug,
      name: project.name,
      description: typeof project.description === 'string' ? project.description : null,
      relativePath: typeof project.relativePath === 'string' ? project.relativePath : basename(stackDir),
      repositories,
    }
  } catch {
    return null
  }
}

/**
 * Create the Project of every started example the panel does not have yet,
 * with its repositories.
 *
 * A 409 is the second run finding the first one's Project or repository, which
 * is success. The Project carries the example's path, and that is what places
 * the running environment under it; a repository's place under Projects Home is
 * what joins it to the host's Git scan.
 */
export async function registerDemoProjects(command: Command, stacks: DemoStack[], token?: string): Promise<void> {
  const projects = stacks
    .map((stack) => readDemoProject(stack.dir))
    .filter((project): project is DemoProject => project !== null)
  if (projects.length === 0) return
  const { client, output } = clientFor(command, { actor: undefined, actorKind: 'human', ...(token ? { token } : {}) })
  for (const { repositories, ...project } of projects) {
    const created = await client.answer('POST', '/projects', project)
    if (created.ok) output.progress(`registered Project ${project.name} (${project.slug})`)
    else if (created.status === 409) output.progress(`Project ${project.slug} already registered`)
    else {
      output.warning(`could not register Project ${project.slug}: the panel answered ${created.status}`)
      output.hint(`portta projects create --slug ${project.slug} --path ${project.relativePath}`)
      continue
    }
    for (const repository of repositories) {
      const added = await client.answer(
        'POST',
        `/projects/${encodeURIComponent(project.slug)}/repositories`,
        repository,
      )
      if (!added.ok && added.status !== 409)
        output.warning(
          `could not register repository ${repository.name} on ${project.slug}: the panel answered ${added.status}`,
        )
    }
  }
}

function outputFor(command: Command): Output {
  return new Output(workGlobals(command))
}

export function demoHome(command: Command): string {
  const context = gatewayContext({ profile: workGlobals(command).profile, required: false })
  const userHome = context.env.HOME ?? process.env.HOME ?? ''
  const configured =
    context.env.PORTTA_PROJECTS_HOME?.trim() ||
    defaultProjectsHome(userHome, typeof process.getuid === 'function' && process.getuid() === 0)
  return normalizeProjectsHome(configured, context.root, userHome)
}

/**
 * The example stacks `--demo` starts, or a refusal that names where it looked.
 *
 * Asked before anything starts, so a checkout whose Projects Home holds no
 * `portta-demo-*` repository learns that in the first second rather than after
 * the gateway came up without them (ADR 0044).
 */
export function requireDemoStacks(command: Command): DemoStack[] {
  const home = demoHome(command)
  const stacks = findDemoStacks(home)
  if (stacks.length > 0) return stacks
  throw new PreconditionError(
    `--demo found no portta-demo-* Compose project in ${home}`,
    'clone the example repositories there, or set PORTTA_PROJECTS_HOME in .env to the directory that holds them',
  )
}

export async function demoStacksUp(command: Command, token?: string): Promise<void> {
  const output = outputFor(command)
  const stacks = requireDemoStacks(command)
  output.step('demo stacks')
  for (const stack of stacks) {
    output.progress(`starting ${stack.name}`)
    await runProcess('docker', demoComposeArgs(stack, 'up'), { cwd: stack.dir, stdio: 'inherit' })
  }
  await registerDemoProjects(command, stacks, token)
}

export async function demoStacksDown(command: Command): Promise<void> {
  const output = outputFor(command)
  const stacks = findDemoStacks(demoHome(command))
  if (stacks.length === 0) return
  output.step('demo stacks')
  for (const stack of stacks) {
    output.progress(`stopping ${stack.name}`)
    await runProcess('docker', demoComposeArgs(stack, 'down'), { cwd: stack.dir, stdio: 'inherit' })
  }
}

function panelHealthUrl(command: Command): string {
  const context = gatewayContext({ profile: workGlobals(command).profile, required: false })
  const host =
    context.config.webExpose === 'public' ? '127.0.0.1' : (context.env.PORTTA_WEB_BIND_ADDRESS ?? '127.0.0.1')
  const port = context.config.webPort || Number(context.env.PORTTA_WEB_PORT ?? 8081)
  return `http://${host}:${port}/api/health`
}

export async function panelIsReachable(command: Command): Promise<boolean> {
  try {
    const response = await fetch(panelHealthUrl(command), { signal: AbortSignal.timeout(3000) })
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

export async function waitForPanel(command: Command, timeoutMs = PANEL_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await panelIsReachable(command)) return
    await new Promise((resolve) => setTimeout(resolve, PANEL_POLL_MS))
  }
  throw new PreconditionError(
    'the panel did not become reachable in time',
    'start it with `portta web up` or `portta dev`, then retry',
  )
}

/**
 * The well-known checkout owner, created once while setup is still open.
 *
 * `dev` is the only caller. An installation never posts these credentials and
 * leaves `/setup` to the operator. A 409 means somebody already created an
 * owner, which is success for a second `dev`. The token, when minted, is what
 * the rest of the run uses on a panel that now asks who you are.
 */
export async function ensureDevDemoOwner(command: Command): Promise<string | undefined> {
  const { client, output } = clientFor(command, { actor: undefined, actorKind: 'human' })
  const status = await client.request<{ mode: string; setupRequired: boolean }>('GET', '/auth/status')
  if (status.mode === 'open') {
    output.progress('panel is open; demo owner is not needed')
    return undefined
  }

  let seeded = false
  if (status.setupRequired) {
    const created = await client.answer('POST', '/auth/setup', { ...DEV_DEMO_OWNER })
    if (created.status === 409) {
      output.progress('panel already has an owner')
    } else if (!created.ok) {
      await client.request('POST', '/auth/setup', { ...DEV_DEMO_OWNER })
      seeded = true
    } else {
      output.progress(`created demo owner ${DEV_DEMO_OWNER.email}`)
      seeded = true
    }
  } else {
    output.progress('panel already has an owner')
  }

  const token = await mintDevDemoToken(client.url)
  if (seeded || token) output.progress(`sign in as ${DEV_DEMO_OWNER.email} / ${DEV_DEMO_OWNER.password}`)
  return token
}

async function mintDevDemoToken(url: string): Promise<string | undefined> {
  try {
    const origin = url
    const host = new URL(url).host
    const signedIn = await fetch(`${url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, host },
      body: JSON.stringify({ email: DEV_DEMO_OWNER.email, password: DEV_DEMO_OWNER.password }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!signedIn.ok) return undefined
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) return undefined
    const minted = await fetch(`${url}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, host, cookie },
      body: JSON.stringify({ name: 'dev-demo', actorKind: 'human' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!minted.ok) return undefined
    const body = (await minted.json()) as { token?: string }
    return typeof body.token === 'string' ? body.token : undefined
  } catch {
    return undefined
  }
}
