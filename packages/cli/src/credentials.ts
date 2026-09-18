// Where a token lives between two commands.
//
// `portta auth login` writes it here so the next command does not need
// `PORTTA_TOKEN` in the environment, which is how a token ends up in a shell
// history, in a process listing, and in whatever collects both. The file is
// owner-only and holds one entry per panel URL, because a person may have a
// laptop panel and a server one and they are not the same credential.

import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CREDENTIALS_VERSION = 1 as const

export interface PanelCredential {
  token: string
  user: string
  role: string
  savedAt: string
}

export interface CredentialStore {
  version: typeof CREDENTIALS_VERSION
  panels: Record<string, PanelCredential>
}

/** `$XDG_CONFIG_HOME` when it is set, the way every other tool on the host reads it. */
export function credentialsPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.PORTTA_CREDENTIALS
  if (base) return base
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config')
  return join(config, 'portta', 'credentials.json')
}

/** One canonical spelling per panel, so two URLs for one panel are one entry. */
export function panelKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}

function empty(): CredentialStore {
  return { version: CREDENTIALS_VERSION, panels: {} }
}

/**
 * A store that cannot be read is an empty one.
 *
 * Deliberately: a corrupt or unreadable file must not stop `portta projects list`
 * on a panel that needs no credential at all. What it costs is one clear
 * "not signed in" instead of a parse error nobody can act on.
 */
export function readCredentials(path = credentialsPath()): CredentialStore {
  if (!existsSync(path)) return empty()
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return empty()
    const store = parsed as Partial<CredentialStore>
    if (store.version !== CREDENTIALS_VERSION || !store.panels || typeof store.panels !== 'object') return empty()
    return { version: CREDENTIALS_VERSION, panels: store.panels }
  } catch {
    return empty()
  }
}

/** Written through a temporary file, mode 0600, like the protection store. */
export function writeCredentials(store: CredentialStore, path = credentialsPath()): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${randomBytes(8).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function saveCredential(url: string, credential: PanelCredential, path = credentialsPath()): void {
  const store = readCredentials(path)
  store.panels[panelKey(url)] = credential
  writeCredentials(store, path)
}

export function findCredential(url: string, path = credentialsPath()): PanelCredential | null {
  return readCredentials(path).panels[panelKey(url)] ?? null
}

/** Returns whether there was one, so `logout` can say so. */
export function forgetCredential(url: string, path = credentialsPath()): boolean {
  const store = readCredentials(path)
  const key = panelKey(url)
  if (!(key in store.panels)) return false
  delete store.panels[key]
  writeCredentials(store, path)
  return true
}
