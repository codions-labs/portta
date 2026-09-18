// Where the panel's database file is, and nothing else.
//
// There is one engine (SQLite) and one question: which file. That question has
// a single answer for the whole installation, and this is it — the panel, the
// CLI and drizzle-kit all resolve it here rather than each building a path
// (docs/development/adr/0037-sqlite-is-the-panel-database.md).
//
// The panel runs in a container and the CLI runs on the host, so the two see
// the same file under different roots. The variable is what bridges them:
// Compose sets `PORTTA_RUNTIME_DATABASE_FILE` to the container path and
// bind-mounts the host directory onto it, and the CLI reads the host path from
// `$PORTTA_HOME`. Neither derives the other's.

import { join } from 'node:path'

/** Inside the panel container. The Compose overlay bind-mounts the host directory here. */
export const DATABASE_CONTAINER_PATH = '/app/state/panel/portta.db'

/**
 * Under `$PORTTA_HOME` on the host.
 *
 * `state/panel/`, deliberately beside and not inside `state/host/`: the daemon
 * owns its own SQLite databases there (ADR 0049) and the two are unrelated —
 * different processes, different lifetimes, different backups. A shared
 * directory would make "which file is the panel's" a thing to look up.
 */
export const DATABASE_RELATIVE_PATH = join('state', 'panel', 'portta.db')

export function databaseFileFor(root: string): string {
  return join(root, DATABASE_RELATIVE_PATH)
}

/**
 * The file this process should open.
 *
 * `root` is the installation directory, and is how the CLI answers when nothing
 * set the variable. The panel always has the variable, because the overlay sets
 * it; a panel without it is a misconfigured container rather than one that
 * should guess, so it gets the documented container path instead of a path
 * under whatever its working directory happens to be.
 */
export function resolveDatabase(env: Record<string, string | undefined>, root?: string): { path: string } {
  const configured = env.PORTTA_RUNTIME_DATABASE_FILE?.trim()
  if (configured) return { path: configured }
  return { path: root ? databaseFileFor(root) : DATABASE_CONTAINER_PATH }
}

/**
 * The files one SQLite database is, for a copy, a backup or a removal.
 *
 * In WAL mode a database is three files, and copying only the first one is how
 * a backup silently loses the most recent writes. Everything that moves a
 * Portta database moves all three.
 */
export function databaseFiles(path: string): string[] {
  return [path, `${path}-wal`, `${path}-shm`]
}
