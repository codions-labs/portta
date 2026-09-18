// Where the daemon keeps its token, and how the token comes to exist.
//
// `$PORTTA_HOME/state/host/` belongs to the daemon, beside the other host
// collectors' `state/*` directories (ADR 0020). The token file is created once,
// owner-only, and never rewritten: the panel mounts the same file read-only,
// so replacing it would lock out a running panel until it restarted.

import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Relative to the installation root. */
export const HOST_STATE_DIR = join('state', 'host')

export function hostStateDir(root: string): string {
  return join(root, HOST_STATE_DIR)
}

/** `PORTTA_HOST_STATE_DIR` when it is set, `state/host` under the installation otherwise. */
export function resolveHostStateDir(root: string, env: Readonly<Record<string, string | undefined>>): string {
  return env.PORTTA_HOST_STATE_DIR?.trim() || hostStateDir(root)
}

export function hostTokenFile(stateDir: string): string {
  return join(stateDir, 'token')
}

/** 256 bits, URL-safe, so it survives a header and a shell variable unquoted. */
function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * The token in `file`, creating it when it does not exist.
 *
 * Created with `wx`, so two daemons starting at once cannot each write a
 * different secret: the loser reads what the winner wrote. A file with group or
 * other bits set is narrowed back to 0600 rather than trusted as it is, and an
 * empty one is refused, because an empty secret would match an empty header.
 */
export function readOrCreateToken(file: string): string {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(file, `${newToken()}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600)
  const token = readFileSync(file, 'utf8').trim()
  if (token === '') throw new Error(`${file} is empty; remove it and start the host daemon again`)
  return token
}
