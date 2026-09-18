import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_NAME } from 'portta-core/taskflow/config'
import { run } from 'portta-host/taskflow/lib/shell'
import { daemonBaseUrl, daemonUnreachableHint, flowApi } from './daemon.ts'
import { flowInvocation } from './flow-action.ts'

// Generic process/git/repo primitives live in the host's shell lib so the host
// and these commands share one implementation.
export {
  detectProjectName,
  getGitRoot,
  run,
  which,
} from 'portta-host/taskflow/lib/shell'

/**
 * Thrown by argparse functions to signal usage errors (e.g. missing flag value,
 * unknown option). Caught at the command entry point so the CLI can print the
 * help banner alongside the message.
 */
export class CommandUsageError extends Error {}

/** Collect repeated `--env KEY=VALUE` values; the split is on the first `=`. */
export function parseEnvOverrides(values: string[] | undefined): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined
  const overrides: Record<string, string> = {}
  for (const value of values) {
    const separatorIndex = value.indexOf('=')
    if (separatorIndex <= 0) throw new CommandUsageError('--env must use KEY=VALUE')
    overrides[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1)
  }
  return overrides
}

/**
 * When the host daemon isn't reachable the bare error message ("fetch failed")
 * is unhelpful. This returns a hint naming the daemon and how to start it for a
 * connection failure, and leaves HTTP/other errors untouched.
 */
export function formatServerError(error: unknown, port: number): string {
  if (error instanceof Error) {
    if (error.message.startsWith('HTTP')) return error.message
    if (error.message.includes('fetch') || error.message.includes('Unable to connect')) {
      return daemonUnreachableHint(port)
    }
    return error.message
  }
  return String(error)
}

export async function withServerConnection<T>(port: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new Error(formatServerError(error, port))
  }
}

/** Resolve a directory to its canonical project (git) root — the shared root
 *  even from a linked worktree — matching the server's `projectRoot()`. Returns
 *  null when the dir isn't a git work tree (or git is unavailable). */
export function resolveProjectRoot(cwd: string = process.cwd()): string | null {
  try {
    const common = run('git', ['rev-parse', '--git-common-dir'], { cwd })
    if (common.success) {
      const commonDir = common.stdout.toString().trim()
      if (commonDir) return dirname(resolve(cwd, commonDir))
    }
    const top = run('git', ['rev-parse', '--show-toplevel'], { cwd })
    return top.success ? top.stdout.toString().trim() : null
  } catch {
    return null
  }
}

/** Canonicalize a filesystem path for equality comparison: collapse symlinks,
 *  trailing slashes, and `.`/`..` segments. The server stores each project's git
 *  root via its own `projectRoot()`, which is `resolve`-based and does not follow
 *  symlinks — so a CLI invoked from a symlinked cwd (or with a trailing slash)
 *  could compute a different-but-equivalent string. Realpathing both sides at
 *  compare time makes the match robust; falls back to `resolve` if the path is
 *  gone (it normally exists, since the server is local). */
function canonicalizePath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Base URL for talking to the active project on the host daemon. The daemon
 *  serves each project under `/api/modules/taskflow/<prefix>`, so a daemon-backed
 *  CLI command must target that for the project at `projectDir`.
 *  Throws a CommandUsageError when `projectDir` isn't a git repo (no project to
 *  scope to) or when its root resolves but isn't a served project. */
export async function resolveProjectBaseUrl(port: number, projectDir: string = process.cwd()): Promise<string> {
  const base = daemonBaseUrl(port)
  const root = resolveProjectRoot(projectDir)
  if (!root) {
    throw new CommandUsageError(
      `Not inside a git repository, so ${APP_NAME} can't tell which project this command targets. cd into a project served by ${APP_NAME} (\`${flowInvocation()} project ls\` lists them) and try again.`,
    )
  }
  const { projects } = await flowApi(base).fetchProjects()
  const target = canonicalizePath(root)
  const match = projects.find((project) => canonicalizePath(project.path) === target)
  if (!match) {
    throw new CommandUsageError(
      `This project (${root}) isn't served by ${APP_NAME} on port ${port}. Run \`${flowInvocation()} project add\` in it first.`,
    )
  }
  return `${base}/${match.prefix}`
}

/** The server serves each project under `/<prefix>`, so an in-process runtime
 *  that writes `control.env` must embed that prefix or the agent's status hooks
 *  POST to an unrouted path. Best-effort: returns `undefined` when the prefix
 *  can't be resolved (no server running, or the repo isn't a served project) so
 *  the caller writes no control URL at all rather than a wrong one. Status
 *  self-heals when the worktree is next opened/refreshed from a dashboard. */
export async function resolveProjectPrefix(
  port: number,
  projectDir: string = process.cwd(),
): Promise<string | undefined> {
  try {
    const base = await resolveProjectBaseUrl(port, projectDir)
    return base.slice(daemonBaseUrl(port).length).replace(/^\/+|\/+$/g, '') || undefined
  } catch {
    return undefined
  }
}
