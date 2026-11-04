import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { execa, type Options } from 'execa'

/**
 * What happens to a child's output.
 *
 *   'inherit'  the child owns the terminal: prompts, Ctrl-C, in-place progress
 *   'pipe'     captured and not shown, for output this CLI parses
 *   'stream'   captured *and* shown, for work a person is waiting on
 *
 * `'pipe'` is the default because most callers here read `result.stdout`.
 * A piped child that takes long is still announced on stderr, so a caller
 * that forgets `stdio` cannot leave a person staring at nothing: see the
 * heartbeat below.
 */
export type Stdio = 'inherit' | 'pipe' | 'stream'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string | Uint8Array
  reject?: boolean
  stdio?: Stdio
  /** Kill the process after this many milliseconds. Used for optional probes. */
  timeout?: number
}

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
  failed: boolean
  /** Why the executable could not be started at all (e.g. `spawn tmux ENOENT`). */
  error?: string
}

export interface ProcessReporting {
  quiet?: boolean
  json?: boolean
  verbose?: boolean
}

/**
 * How this run was invoked, for the two decisions the process layer makes on
 * its own: whether a piped child streams, and whether a slow one says so.
 *
 * Module-level rather than a parameter, deliberately. A hundred call sites
 * pass no context, and this value comes from argv once and never changes;
 * threading it through all of them would be a far larger change for the same
 * result. `cli.ts` sets it before any command runs, and the tests set it
 * directly.
 */
let reporting: ProcessReporting = {}

export function setProcessReporter(options: ProcessReporting): void {
  reporting = options
}

/**
 * `--verbose` means show me what it is doing, so every piped child streams;
 * `--quiet` means the opposite. Neither touches `'inherit'`: that is an
 * explicit hand-over of the terminal — `db shell`, `logs --follow` — and
 * silencing it would break the command rather than quieten it.
 */
export function effectiveStdio(requested: Stdio): Stdio {
  if (requested === 'inherit') return 'inherit'
  if (reporting.quiet) return 'pipe'
  if (reporting.verbose) return 'stream'
  return requested
}

/**
 * Where a streaming child's output goes.
 *
 * Child stderr is always mirrored. Child stdout is mirrored only when `--json`
 * is off, because `docker pull` writes its layer progress to stdout and that
 * would land in the middle of the document a machine is reading. Nothing is
 * lost either way: `'stream'` captures as well as shows, so `result.stdout`
 * is the same string it would have been.
 */
function outputTargets(mode: Stdio): Options {
  if (mode !== 'stream') return { stdio: mode }
  return {
    stdin: 'pipe',
    stdout: reporting.json ? 'pipe' : ['pipe', 'inherit'],
    stderr: ['pipe', 'inherit'],
  }
}

/** A child is only worth mentioning once it has outlived a person's patience. */
const HEARTBEAT_FIRST_MS = 10_000
const HEARTBEAT_EVERY_MS = 30_000
/** Long enough that the question has become "should I stop this?". */
const HEARTBEAT_HINT_MS = 180_000

function elapsed(sinceMs: number): string {
  const seconds = Math.round((Date.now() - sinceMs) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * The command as a person would recognise it, on one line.
 *
 * Only `-f <path>` pairs are dropped, because a Compose invocation carries up
 * to eight overlay paths and nothing else here is long enough to matter.
 * Everything else is kept and the line is truncated: guessing which other
 * flags take a value would be wrong more often than it was right.
 */
export function describeCommand(file: string, args: readonly string[], limit = 88): string {
  const words: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '-f' || argument === '--file') {
      index += 1
      continue
    }
    words.push(argument)
  }
  const line = [file, ...words].join(' ')
  return line.length <= limit ? line : `${line.slice(0, limit - 1)}…`
}

/**
 * Say that a silent child is still going, and for how long.
 *
 * This is the floor under every piped process in the CLI, and the part that
 * makes the class of bug impossible rather than just fixing one instance of
 * it: a caller that forgets `stdio` now costs ten seconds of silence, not ten
 * minutes, and needs to remember nothing for that to be true.
 *
 * stderr only, so `--json` on stdout stays one parseable document. Plain
 * lines, never a carriage return or a cursor move, so a redirected log gains
 * four tidy lines instead of a smear.
 */
function startHeartbeat(file: string, args: readonly string[]): () => void {
  if (reporting.quiet) return () => {}
  const started = Date.now()
  const label = describeCommand(file, args)
  let hinted = false

  const announce = () => {
    process.stderr.write(`wait     still running: ${label} (${elapsed(started)})\n`)
    if (!hinted && Date.now() - started >= HEARTBEAT_HINT_MS) {
      hinted = true
      process.stderr.write(
        '  -> a first build of the panel image takes several minutes; Ctrl-C is safe, and --verbose shows its output\n',
      )
    }
  }

  let repeat: ReturnType<typeof setInterval> | undefined
  // Unreferenced timers: a pending heartbeat must never be why the process
  // stays alive after its work is done.
  const first = setTimeout(() => {
    announce()
    repeat = setInterval(announce, HEARTBEAT_EVERY_MS)
    repeat.unref?.()
  }, HEARTBEAT_FIRST_MS)
  first.unref?.()

  return () => {
    clearTimeout(first)
    if (repeat) clearInterval(repeat)
  }
}

/** The only process primitive in the CLI: executable plus argument array, never a shell string. */
export async function runProcess(
  file: string,
  args: readonly string[] = [],
  options: RunOptions = {},
): Promise<ProcessResult> {
  const mode = effectiveStdio(options.stdio ?? 'pipe')
  const execaOptions: Options = {
    cwd: options.cwd,
    env: options.env,
    input: options.input as string | undefined,
    reject: options.reject ?? true,
    shell: false,
    timeout: options.timeout,
    ...outputTargets(mode),
  }

  // A child already writing to the terminal is speaking for itself.
  const stopHeartbeat = mode === 'pipe' ? startHeartbeat(file, args) : () => {}
  try {
    const result = await execa(file, [...args], execaOptions)
    const notStarted = result.failed && result.exitCode === undefined && !result.signal && !result.timedOut
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      exitCode: result.exitCode ?? (result.failed ? 1 : 0),
      failed: result.failed,
      ...(notStarted && 'originalMessage' in result ? { error: String(result.originalMessage) } : {}),
    }
  } finally {
    stopHeartbeat()
  }
}

/**
 * Run a long-lived child as if it were this process, and return its exit code.
 *
 * For a daemon started in the foreground: it owns the terminal, and the signals
 * this process receives are passed on, so a service manager that stops the CLI
 * stops the child with it instead of leaving it orphaned.
 */
export async function runForeground(
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const child = execa(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
    reject: false,
    shell: false,
  })
  const forwarded = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(
    (signal) =>
      [
        signal,
        () => {
          child.kill(signal)
        },
      ] as const,
  )
  for (const [signal, forward] of forwarded) process.on(signal, forward)
  try {
    const result = await child
    return result.exitCode ?? (result.signal ? 1 : 0)
  } finally {
    for (const [signal, forward] of forwarded) process.off(signal, forward)
  }
}

/**
 * Start a process that must outlive this command.
 *
 * The only caller is `remote access open`, which leaves an SSH tunnel running
 * after the CLI exits — the whole point of the command is a local address that
 * still answers once the terminal is free. Detached and unreferenced, with its
 * output discarded, because a background process writing to a closed terminal
 * is how a tunnel dies silently.
 *
 * Still an argument array and still no shell: the exception is the lifetime,
 * not the policy.
 */
export function spawnDetached(
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; logFile?: string } = {},
): number | undefined {
  // A daemon that has somewhere to write keeps its output there instead: a
  // file it appends to outlives the terminal that started it.
  const log = options.logFile ? openSync(options.logFile, 'a', 0o600) : null
  try {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: log === null ? 'ignore' : ['ignore', log, log],
    })
    child.unref()
    return child.pid
  } finally {
    if (log !== null) closeSync(log)
  }
}
