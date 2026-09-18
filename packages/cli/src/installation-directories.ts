import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The directories an installation carries, with the mode each must end up
 * with. Most are bind-mounted by the compose files: a missing one makes
 * Docker create it as root, which then breaks the panel writing to it.
 * Created with the right mode, so the permission pass in `repair` never
 * reports work this list just made for it.
 *
 * One list for `setup`, `bootstrap`, `web up` and `repair`, so no command can
 * drift into creating a directory the others do not know about.
 */
export const INSTALLATION_DIRECTORIES: ReadonlyArray<{ path: string; mode: number }> = [
  { path: 'config/traefik/dynamic', mode: 0o755 },
  { path: 'config/tls', mode: 0o755 },
  { path: 'state/auth', mode: 0o700 },
  { path: 'state/ssh', mode: 0o700 },
  { path: 'state/runner', mode: 0o700 },
  { path: 'state/cloudflared', mode: 0o700 },
  { path: 'state/traefik/acme', mode: 0o700 },
  { path: 'state/access', mode: 0o755 },
  { path: 'state/tailscale', mode: 0o755 },
  { path: 'state/git', mode: 0o755 },
  { path: 'state/metrics', mode: 0o755 },
  { path: 'state/environment', mode: 0o755 },
  { path: 'state/logs', mode: 0o755 },
]

/**
 * Creates what is missing. A directory that holds secrets is always brought
 * back to owner-only; a public one keeps whatever mode it already has.
 */
export function ensureInstallationDirectories(root: string): void {
  for (const { path, mode } of INSTALLATION_DIRECTORIES) {
    const full = join(root, path)
    const created = !existsSync(full)
    mkdirSync(full, { recursive: true })
    if (created || mode === 0o700) chmodSync(full, mode)
  }
}
