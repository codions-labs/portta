// The project runner: the one thing on a host that may drive a consumer
// project's Compose on the panel's behalf.
//
// The panel's Docker permissions stop at start, stop, restart and one fixed
// container shape (ADR 0008). Rebuilding, taking a project down, or starting
// containers that no longer exist means Compose, and reimplementing Compose
// inside the panel is not an option (ADR 0026). So `up` prepares a
// single-purpose container, stopped, whose command is fixed at creation and
// reads a closed `{ verb, project }` request — never a command line.
// Starting it is a permission the panel already has. See ADR 0030.
//
// This is the source of truth used by the TypeScript CLI.

import { porttaImages } from './images.ts'

export const RUNNER_CONTAINER = 'portta-runner'
export const RUNNER_COMPONENT = 'runner'

/**
 * Operations Compose must perform. Adding a verb is an ADR-level change.
 *
 * `down-volumes` is the destructive form of `down`. It is a distinct verb so
 * a request cannot smuggle `--volumes` onto a preserving removal.
 */
export const RUNNER_VERBS = ['up', 'stop', 'restart', 'build', 'down', 'down-volumes'] as const
export type RunnerVerb = (typeof RUNNER_VERBS)[number]

export const RUNNER_FLAGS = ['no-cache', 'directory'] as const
export type RunnerFlag = (typeof RUNNER_FLAGS)[number]

export interface RunnerRequest {
  verb: RunnerVerb
  project: string
  flags?: RunnerFlag[]
  /**
   * Where Compose runs, for an `up` of a project that has no container left
   * to read labels from (a remembered Environment). Ignored by the runner
   * when a container exists: labels win.
   */
  workingDir?: string
  /** The Compose files, absolute host paths, in the order the daemon recorded them. */
  configFiles?: string[]
}

export function isRunnerVerb(value: string): value is RunnerVerb {
  return (RUNNER_VERBS as readonly string[]).includes(value)
}

export function isRunnerFlag(value: string): value is RunnerFlag {
  return (RUNNER_FLAGS as readonly string[]).includes(value)
}

export function parseRunnerRequest(value: unknown): RunnerRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the runner request must be an object')
  }
  const body = value as Record<string, unknown>
  if (typeof body.verb !== 'string' || !isRunnerVerb(body.verb)) {
    throw new Error(`unknown runner verb '${String(body.verb)}'`)
  }
  if (typeof body.project !== 'string' || body.project.trim() === '') {
    throw new Error('the runner request needs a project name')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(body.project)) {
    throw new Error(`refusing project name '${body.project}'`)
  }
  const flags: RunnerFlag[] = []
  if (body.flags !== undefined) {
    if (!Array.isArray(body.flags)) throw new Error('runner flags must be an array')
    for (const flag of body.flags) {
      if (typeof flag !== 'string' || !isRunnerFlag(flag)) {
        throw new Error(`unknown runner flag '${String(flag)}'`)
      }
      flags.push(flag)
    }
  }
  if (flags.includes('no-cache') && body.verb !== 'build') {
    throw new Error('no-cache is only valid with build')
  }
  if (flags.includes('directory') && body.verb !== 'down-volumes') {
    throw new Error('directory is only valid with down-volumes')
  }
  const request: RunnerRequest = { verb: body.verb, project: body.project, flags: flags.length > 0 ? flags : undefined }
  if (body.workingDir !== undefined || body.configFiles !== undefined) {
    if (body.verb !== 'up') throw new Error('workingDir and configFiles are only valid with up')
    if (typeof body.workingDir !== 'string') throw new Error('configFiles need a workingDir')
    request.workingDir = assertRunnerPath(body.workingDir, 'working directory')
    if (body.configFiles !== undefined) {
      if (!Array.isArray(body.configFiles)) throw new Error('configFiles must be an array')
      request.configFiles = body.configFiles.map((file) => {
        if (typeof file !== 'string') throw new Error('every compose file must be a string')
        return assertRunnerPath(file, 'compose file')
      })
    }
  }
  return request
}

/**
 * The bound a path in a runner request must satisfy: the same one
 * `remove_working_dir` applies in scripts/lib/runner-exec.sh (absolute, no
 * `..` segment, not `/`, not a top-level directory), plus the two characters
 * the shell parser cannot carry (a comma splits the list, a quote ends it).
 */
export function assertRunnerPath(value: string, what: string): string {
  if (value.trim() === '' || value !== value.trim()) throw new Error(`refusing ${what} '${value}': padded or empty`)
  if (value.includes('\0') || value.includes('\n')) throw new Error(`refusing ${what} with a control character`)
  if (value.includes(',') || value.includes('"') || value.includes('\\')) {
    throw new Error(`refusing ${what} '${value}': commas, quotes and backslashes cannot be carried`)
  }
  if (!value.startsWith('/')) throw new Error(`refusing ${what} '${value}': not absolute`)
  const parts = value.split('/')
  if (parts.includes('..')) throw new Error(`refusing ${what} '${value}': walks up`)
  if (value === '/') throw new Error(`refusing ${what} '/'`)
  if (parts.filter((part) => part.length > 0).length < 2)
    throw new Error(`refusing ${what} '${value}': a top-level directory`)
  return value
}

export function runnerCreateArguments(root: string, spec: string, version: string): string[] {
  return [
    'create',
    '--name',
    RUNNER_CONTAINER,
    '--label',
    'portta.managed=true',
    '--label',
    `portta.component=${RUNNER_COMPONENT}`,
    '--label',
    `portta.runner.spec=${spec}`,
    '--label',
    'traefik.enable=false',
    '--restart',
    'no',
    '--network',
    'none',
    '--user',
    '0:0',
    '--security-opt',
    'no-new-privileges:true',
    '--workdir',
    root,
    '--env',
    `PORTTA_ROOT=${root}`,
    '--env',
    'HOME=/tmp',
    '--volume',
    '/var/run/docker.sock:/var/run/docker.sock',
    '--volume',
    `${root}:${root}`,
    // The host filesystem, so the runner can read a project's Compose files
    // at the path Docker recorded. --project-directory stays the host path.
    '--volume',
    '/:/host',
    porttaImages(version).apply,
    'bash',
    `${root}/scripts/lib/runner-exec.sh`,
  ]
}

export function runnerSpec(root: string, version: string): string {
  return `${porttaImages(version).apply}|${root}|${version}`
}

/**
 * Why this host must not prepare a runner, or null when it may.
 *
 * The same public-exposure refusals as the applier: handing Compose over a
 * panel reachable from the internet is a different decision from handing it
 * over loopback.
 */
export function runnerRefusal(env: Record<string, string | undefined>): string | null {
  if ((env.PORTTA_WEB_EXPOSE ?? 'local') === 'public') {
    return 'the panel is exposed publicly: operate projects on the host instead'
  }
  if ((env.PORTTA_PROFILE ?? 'local') === 'remote-public') {
    return 'the remote-public profile operates projects on the host only'
  }
  return null
}

export function composeFilesFromLabel(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export interface ProjectOperable {
  ok: boolean
  reason: string | null
  workingDir: string | null
  configFiles: string[]
}

/** Labels are the project's own truth. Missing ones are not operable. */
export function projectOperable(workingDir: string | null, configFiles: string[] = []): ProjectOperable {
  if (!workingDir) {
    return {
      ok: false,
      reason: 'this project has no Compose working directory label, so the runner cannot find it',
      workingDir: null,
      configFiles,
    }
  }
  return { ok: true, reason: null, workingDir, configFiles }
}
