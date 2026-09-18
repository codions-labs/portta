// Running `gh`, and turning what it says into something the panel can show.
//
// The panel is a container with no `gh`, no PATH to the operator's tools and no
// GitHub credential. The daemon has all three, which is why the Issues surface
// lives here at all (ADR 0018, ADR 0047).
//
// Every call is `gh` with `--json`: no REST paths hand-rolled, no token read,
// no Octokit. `gh` already knows which host a repository is on, which account
// is authenticated and how to page — reimplementing any of that would be a
// second, worse client for a tool the operator already has configured.
//
// Nothing here is cached. An issue read twice is fetched twice, because the
// alternative is a mirror, and the mirror is exactly what this replaced.

import { execFile } from 'node:child_process'
import { resolveHostToolThoroughly } from '../modules/taskflow/lib/host-tools.ts'

/** Long enough for a cold `gh` on a slow network, short enough that a hung one is not a hung panel. */
const TIMEOUT_MS = 20_000

/** `gh` pages for us; this is the ceiling on one listing, matching what a page shows. */
export const ISSUE_PAGE_LIMIT = 100

/**
 * Why a forge call failed, in the vocabulary the panel renders.
 *
 * `gh` exits non-zero with prose on stderr rather than a typed error, so this
 * is where prose becomes a decision. The panel shows a different screen for
 * each: "install gh", "run gh auth login", "this repository is not yours",
 * "GitHub is rate-limiting you", "GitHub is down". Collapsing them into one
 * "request failed" is how an operator ends up re-authenticating to fix a 404.
 */
export type ForgeFailure =
  | 'unavailable' // gh is not installed, or not on any PATH the daemon can see
  | 'unauthenticated' // gh is installed but nobody has signed in
  | 'forbidden' // signed in, but not for this repository
  | 'not-found' // no such repository or issue
  | 'rate-limited'
  | 'timeout'
  | 'failed'

export class ForgeError extends Error {
  readonly kind: ForgeFailure
  readonly hint: string | undefined

  constructor(kind: ForgeFailure, message: string, hint?: string) {
    super(message)
    this.name = 'ForgeError'
    this.kind = kind
    this.hint = hint
  }
}

export const FORGE_STATUS = {
  unavailable: 503,
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  'rate-limited': 429,
  timeout: 504,
  failed: 502,
} as const satisfies Record<ForgeFailure, number>

function classify(stderr: string): ForgeFailure {
  const text = stderr.toLowerCase()
  if (text.includes('gh auth login') || text.includes('not logged') || text.includes('authentication token')) {
    return 'unauthenticated'
  }
  if (text.includes('rate limit') || text.includes('secondary rate')) return 'rate-limited'
  // GitHub answers 404 for a private repository the caller cannot see, so a
  // "not found" on a repository somebody named is more often a permission
  // problem than a typo. The message says so rather than picking one.
  if (text.includes('could not resolve to') || text.includes('not found') || text.includes('404')) return 'not-found'
  if (text.includes('forbidden') || text.includes('403') || text.includes('must have admin')) return 'forbidden'
  return 'failed'
}

let resolved: string | null | undefined

/** Resolved once: the login-shell probe behind it is slow, and `gh` does not move. */
function ghPath(): string {
  if (resolved === undefined) resolved = resolveHostToolThoroughly('gh')
  if (!resolved) {
    throw new ForgeError(
      'unavailable',
      'the GitHub CLI is not installed on this host',
      'install gh (https://cli.github.com) and run gh auth login, then reload',
    )
  }
  return resolved
}

export function runGh(args: readonly string[], options: { cwd?: string; stdin?: string } = {}): Promise<string> {
  const binary = ghPath()
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      args as string[],
      {
        cwd: options.cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        // `gh` colours and paginates when it thinks it is talking to a person.
        // Both would end up in the JSON the panel parses.
        env: { ...process.env, GH_PAGER: 'cat', NO_COLOR: '1', GH_PROMPT_DISABLED: '1' },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if ((error as { killed?: boolean }).killed) {
          return reject(
            new ForgeError('timeout', `gh ${args[0]} ${args[1] ?? ''} took longer than ${TIMEOUT_MS / 1000}s`),
          )
        }
        const detail = (stderr || error.message).trim()
        reject(new ForgeError(classify(detail), detail.split('\n')[0] ?? 'gh failed', hintFor(classify(detail))))
      },
    )
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin)
    }
  })
}

function hintFor(kind: ForgeFailure): string | undefined {
  if (kind === 'unauthenticated') return 'run gh auth login on this host'
  if (kind === 'rate-limited') return 'GitHub is rate-limiting this account; try again shortly'
  if (kind === 'forbidden') return 'this account cannot see or write that repository'
  return undefined
}

export async function runGhJson<T>(args: readonly string[], options?: { cwd?: string }): Promise<T> {
  const stdout = await runGh(args, options)
  const text = stdout.trim()
  if (text === '') return [] as unknown as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ForgeError('failed', `gh answered something that is not JSON: ${text.slice(0, 200)}`)
  }
}

/** Whether this host can operate GitHub at all, and what is missing when it cannot. */
export async function ghStatus(): Promise<{
  available: boolean
  authenticated: boolean
  account: string | null
  detail: string | null
}> {
  let binary: string
  try {
    binary = ghPath()
  } catch (error) {
    return { available: false, authenticated: false, account: null, detail: (error as ForgeError).message }
  }
  try {
    const user = await runGhJson<{ login: string }>(['api', 'user', '--jq', '{login: .login}'])
    return { available: true, authenticated: true, account: user.login, detail: null }
  } catch (error) {
    const failure = error instanceof ForgeError ? error : null
    return {
      available: true,
      authenticated: false,
      account: null,
      detail: failure?.message ?? `gh at ${binary} could not be asked who it is`,
    }
  }
}
