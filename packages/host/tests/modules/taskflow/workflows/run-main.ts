import { main } from '../../../../src/modules/taskflow/workflows/cli.ts'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Run the CLI's main() in-process, capturing stdout/stderr and the exit code it sets. process.exitCode
 * is reset afterwards so a deliberate exit-1 path doesn't fail the test process itself. A rejection
 * (e.g. UsageError, which the entrypoint would print) propagates to the caller.
 */
export async function runMain(argv: string[]): Promise<RunResult> {
  const out = { stdout: '', stderr: '' }
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  // The CLI only writes strings. Binary chunks are the test runner's own serialized reports (sent
  // over this process's stdout) and must pass through, or results of other tests get swallowed.
  const capture =
    (key: 'stdout' | 'stderr', orig: typeof process.stdout.write) =>
    (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      if (typeof chunk !== 'string') return Reflect.apply(orig, process[key], [chunk, ...rest])
      out[key] += chunk
      return true
    }
  process.stdout.write = capture('stdout', origOut) as typeof process.stdout.write
  process.stderr.write = capture('stderr', origErr) as typeof process.stderr.write
  process.exitCode = undefined
  try {
    await main(argv)
    return { code: typeof process.exitCode === 'number' ? process.exitCode : 0, ...out }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
    process.exitCode = undefined
  }
}
