// What the last successful `portta up` was handed, as the panel reads it.
//
// A saved setting is "pending" when `.env` no longer says what it said when the
// gateway was last brought up. It used to be decided by comparing `.env` with
// the panel's own environment, but the CLI derives several values before it
// hands them to Compose (the domain from the domain mode, the bind address and
// the profile from the profile argument), so for those keys `.env` and the
// running process disagree for ever and no `up` can reconcile them.
//
// So `up` records the `.env` it applied, and "pending" is a difference between
// two snapshots of the same file. See ADR 0026.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Relative to PORTTA_HOME; `state/panel` is the directory the panel mounts. */
export const APPLIED_FILE = 'state/panel/applied-env.json'

/** Where the panel finds it, inside its container. */
export const APPLIED_FILE_IN_PANEL = '/app/state/panel/applied-env.json'

const SECRET_KEY = /(SECRET|TOKEN|AUTHKEY|PASSWORD|API_KEY)$/

/**
 * Secrets are recorded as a digest, so this file never holds a second copy of
 * one. The panel's catalogue flags the same keys; a test keeps the two aligned.
 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface AppliedSnapshot {
  version: 1
  appliedAt: string
  /** Every non-secret key of `.env`, as it was. */
  values: Record<string, string>
  /** Every secret key of `.env`, as a digest. */
  secrets: Record<string, string>
}

export function snapshotOf(env: Map<string, string>, now: Date = new Date()): AppliedSnapshot {
  const values: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  for (const [key, value] of env) {
    if (isSecretKey(key)) secrets[key] = digest(value)
    else values[key] = value
  }
  return { version: 1, appliedAt: now.toISOString(), values, secrets }
}

/** Null when there is no usable record: never applied, or written by something else. */
export function readApplied(path: string): AppliedSnapshot | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppliedSnapshot>
    if (parsed.version !== 1 || typeof parsed.values !== 'object' || typeof parsed.secrets !== 'object') return null
    if (parsed.values === null || parsed.secrets === null) return null
    return parsed as AppliedSnapshot
  } catch {
    return null
  }
}

/** Written beside the target and renamed over it, so a reader never sees half of one. */
export function writeApplied(root: string, env: Map<string, string>): void {
  const path = join(root, APPLIED_FILE)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(snapshotOf(env), null, 2)}\n`, { mode: 0o644 })
  renameSync(temporary, path)
}

/** What a key was when applied; a key that was absent was empty. */
export function appliedValue(applied: AppliedSnapshot, key: string): string {
  return isSecretKey(key) ? (applied.secrets[key] ?? digest('')) : (applied.values[key] ?? '')
}

/** Compares a saved value with the applied one, secrets by digest. */
export function differsFromApplied(applied: AppliedSnapshot, key: string, saved: string | null): boolean {
  const now = saved ?? ''
  return isSecretKey(key) ? digest(now) !== appliedValue(applied, key) : now !== appliedValue(applied, key)
}
