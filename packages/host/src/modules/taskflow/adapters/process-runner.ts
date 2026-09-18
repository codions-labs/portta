import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { resolveHostTool } from '../lib/host-tools.ts'

export interface ProcessSpec {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  stdin?: string | Uint8Array
  keepStdinOpen?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  killSignal?: NodeJS.Signals
  graceMs?: number
}

export interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
}

export interface RunningProcess {
  readonly pid: number | undefined
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<ProcessExit>
  writeStdin(input: string | Uint8Array): Promise<void>
  closeStdin(): void
  kill(signal?: NodeJS.Signals): boolean
}

export interface ProcessRunner {
  start(spec: ProcessSpec): RunningProcess
}

interface ManagedWebStream {
  stream: ReadableStream<Uint8Array>
  close(): void
}

function webStream(stream: Readable): ManagedWebStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let ended = false
  return {
    stream: new ReadableStream<Uint8Array>({
      start(streamController): void {
        controller = streamController
        stream.on('data', (chunk: unknown): void => {
          if (!ended)
            streamController.enqueue(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk)))
        })
        stream.on('end', (): void => {
          if (ended) return
          ended = true
          streamController.close()
        })
        stream.on('error', (error: unknown): void => {
          if (ended) return
          ended = true
          streamController.error(error)
        })
      },
      cancel(): void {},
    }),
    close(): void {
      if (ended || !controller) return
      ended = true
      controller.close()
    },
  }
}

function writeToStdin(stream: NodeJS.WritableStream, input: string | Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject): void => {
    stream.write(input, (error: Error | null | undefined): void => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export class NodeProcessRunner implements ProcessRunner {
  start(spec: ProcessSpec): RunningProcess {
    const command = resolveHostTool(spec.command) ?? spec.command
    const child: ChildProcessWithoutNullStreams = spawn(command, spec.args, {
      cwd: spec.cwd,
      env: spec.env === undefined ? undefined : { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const stdout = webStream(child.stdout)
    const stderr = webStream(child.stderr)
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    let exitPoll: ReturnType<typeof setInterval> | undefined
    let settled = false
    let resolveExit: (exit: ProcessExit) => void = (): void => {}
    const exited = new Promise<ProcessExit>((resolve): void => {
      resolveExit = resolve
    })
    const finish = (code: number | null, signal: NodeJS.Signals | null, closeOutputs = false): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (escalation) clearTimeout(escalation)
      if (exitPoll) clearInterval(exitPoll)
      spec.signal?.removeEventListener('abort', abort)
      if (closeOutputs) {
        stdout.close()
        stderr.close()
      }
      resolveExit({ code, signal, timedOut })
    }
    const killTree = (signal: NodeJS.Signals): boolean => {
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal)
          return true
        } catch {
          return child.kill(signal)
        }
      }
      return child.kill(signal)
    }
    const terminate = (signal: NodeJS.Signals): void => {
      if (settled) return
      killTree(signal)
      const graceMs = spec.graceMs ?? 5_000
      escalation = setTimeout((): void => {
        if (!settled) killTree('SIGKILL')
      }, graceMs)
    }
    const abort = (): void => terminate(spec.killSignal ?? 'SIGTERM')
    child.once('error', (): void => {
      finish(child.exitCode, child.signalCode, true)
    })
    exitPoll = setInterval((): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        finish(child.exitCode, child.signalCode)
      }
    }, 10)
    if (spec.keepStdinOpen) {
      if (spec.stdin !== undefined) void writeToStdin(child.stdin, spec.stdin)
    } else if (spec.stdin !== undefined) child.stdin.end(spec.stdin)
    else child.stdin.end()
    if (spec.timeoutMs !== undefined) {
      timeout = setTimeout((): void => {
        timedOut = true
        abort()
      }, spec.timeoutMs)
    }
    if (spec.signal?.aborted) abort()
    else spec.signal?.addEventListener('abort', abort, { once: true })
    return {
      pid: child.pid,
      stdout: stdout.stream,
      stderr: stderr.stream,
      exited,
      writeStdin: (input: string | Uint8Array): Promise<void> => writeToStdin(child.stdin, input),
      closeStdin: (): void => {
        child.stdin.end()
      },
      kill: (signal: NodeJS.Signals = 'SIGTERM'): boolean => killTree(signal),
    }
  }
}

export async function runCaptured(
  runner: ProcessRunner,
  spec: ProcessSpec,
): Promise<{ stdout: string; stderr: string; exit: ProcessExit }> {
  const process = runner.start(spec)
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { stdout, stderr, exit }
}
