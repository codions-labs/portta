import {
  type CheckDetail,
  type DoctorCheck,
  type EnvironmentToolFacts,
  type EnvironmentToolOptions,
  environmentToolVerdict,
} from 'portta-core'
import type { ProbeContext } from './types.js'

const PROBE_TIMEOUT_MS = 4_000

function firstLine(value: string): string | null {
  return (
    value
      .trim()
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? null
  )
}

export async function toolFacts(
  context: ProbeContext,
  command: string,
  versionArgs: readonly string[],
): Promise<EnvironmentToolFacts> {
  const path = await context.locate(command)
  if (!path) return { installed: false, path: null, version: null, onPath: false, usable: false }
  const [version, onPath] = await Promise.all([
    context.run(path, versionArgs, { reject: false, timeout: PROBE_TIMEOUT_MS }),
    context.run('which', [command], { reject: false, timeout: PROBE_TIMEOUT_MS }),
  ])
  return {
    installed: true,
    path,
    version: version.failed ? null : firstLine(version.stdout || version.stderr),
    onPath: !onPath.failed && onPath.stdout.trim() !== '',
    usable: !version.failed,
    ...(version.failed ? { problem: 'installed but its version command failed or timed out' } : {}),
  }
}

export function detail(status: CheckDetail['status'], text: string): CheckDetail {
  return { status, text }
}

/** Fold sub-findings into the row without letting neutral evidence downgrade it. */
export function withDetails(
  facts: EnvironmentToolFacts,
  options: EnvironmentToolOptions,
  details: CheckDetail[],
): DoctorCheck {
  const base = environmentToolVerdict(facts, { ...options, details })
  if (!facts.installed || !facts.usable || !facts.onPath) return base
  const status = details.some((entry) => entry.status === 'fail')
    ? 'fail'
    : details.some((entry) => entry.status === 'warn')
      ? 'warn'
      : 'pass'
  return { ...base, status, details, fix: status === 'pass' ? '' : (options.fix ?? '') }
}

export function versionText(value: string | null): string {
  return value ?? 'version unavailable'
}

export { PROBE_TIMEOUT_MS }
