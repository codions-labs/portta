// What the panel may know about the files of a project.
//
// The panel never opens a project's folder. The collector, which runs on the host, writes a bounded
// copy of what is safe to show under state/files/<environment>/, and the panel reads that copy. The
// rules about what is safe are here, in one place, because the collector applies them when it writes
// and the panel applies them again when it reads. See
// docs/development/adr/0058-the-collector-publishes-a-read-only-copy-of-the-files.md.

import { createHash } from 'node:crypto'

export const FILES_MAX_ENTRIES = 3000
export const FILES_MAX_TEXTS = 400
export const FILES_MAX_TEXT_BYTES = 64 * 1024
export const FILES_MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const FILES_MAX_DIFF_BYTES = 64 * 1024

/** Why a file has no text to show, or `text` when it has. */
export type FileReadable = 'text' | 'hidden' | 'binary' | 'large' | 'omitted'
export type FileStatus = 'M' | 'A' | 'D' | 'U'

export interface PublishedFile {
  path: string
  kind: 'file' | 'dir' | 'link'
  size: number | null
  status: FileStatus | null
  /** A directory or file that git ignores, such as node_modules. Listed, never read. */
  ignored: boolean
  readable: FileReadable
  /** Whether there are changes to show against the last commit. */
  diff: boolean
}

export interface PublishedFiles {
  version: 1
  environment: string
  branch: string | null
  head: { hash: string; subject: string; at: number } | null
  changed: number
  untracked: number
  ahead: number | null
  collectedAt: number
  truncated: boolean
  files: PublishedFile[]
}

/** The name of the blob for a path. The panel finds text by the index, never by building a path. */
export function fileKey(path: string): string {
  return createHash('sha256').update(path).digest('hex')
}

const SECRET_NAMES = [
  /^\.env(\..+)?$/i,
  /^\.envrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.htpasswd$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^credentials(\..+)?$/i,
  /^secrets?(\..+)?$/i,
  /^service-account.*\.json$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|asc|gpg|tfstate)$/i,
  /\.tfstate\.backup$/i,
  /\.tfvars$/i,
]
const SAFE_ENV_EXAMPLES = /^\.env\.(example|sample|template|dist|defaults)$/i
const SECRET_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])

/** A file that usually holds a secret: the panel says it exists and shows nothing of it. */
export function isSecretPath(path: string): boolean {
  const parts = path.split('/').filter(Boolean)
  const name = parts.at(-1) ?? ''
  if (parts.slice(0, -1).some((part) => SECRET_DIRECTORIES.has(part))) return true
  if (SAFE_ENV_EXAMPLES.test(name)) return false
  return SECRET_NAMES.some((pattern) => pattern.test(name))
}

/** A path as git writes it: relative, forward slashes, nothing that climbs out of the folder. */
export function isSafeRelativePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\0') || path.includes('\\')) return false
  return !path.split('/').some((part) => part === '' || part === '.' || part === '..')
}

export function isFileEnvironmentName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)
}
