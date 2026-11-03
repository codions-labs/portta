// A bounded, read-only copy of what is safe to show of a project's files.
//
// The panel never opens a project's folder and has no way to ask the host for one: this writes, on
// the host, what it may read, under state/files/<environment>/. What is written is chosen here,
// with git as the list so that ignored files are left out, and every file is opened through a
// descriptor that does not follow links and is checked to lie inside the folder. A file that usually
// holds a secret is listed and never read. See
// docs/development/adr/0058-the-collector-publishes-a-read-only-copy-of-the-files.md.

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join, sep } from 'node:path'
import {
  FILES_MAX_DIFF_BYTES,
  FILES_MAX_ENTRIES,
  FILES_MAX_TEXT_BYTES,
  FILES_MAX_TEXTS,
  FILES_MAX_TOTAL_BYTES,
  type FileReadable,
  type FileStatus,
  fileKey,
  isFileEnvironmentName,
  isSafeRelativePath,
  isSecretPath,
  type PublishedFile,
  type PublishedFiles,
} from 'portta-core'
import { withRepository } from './git.js'
import { writeAtomic } from './store.js'

const CACHE_MS = 30_000
const last = new Map<string, number>()

export function filesDir(root: string): string {
  return join(root, 'state/files')
}

function splitNul(text: string | null): string[] {
  return (text ?? '').split('\0').filter((entry) => entry !== '')
}

/** The file, if it is a regular one inside the folder, read through the descriptor that was checked. */
function readText(
  real: string,
  path: string,
  limit: number,
): { text: string | null; size: number; readable: FileReadable } {
  const full = join(real, path)
  let fd: number
  try {
    const inside = realpathSync(full)
    if (inside !== join(real, path) && !inside.startsWith(real + sep))
      return { text: null, size: 0, readable: 'omitted' }
    fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return { text: null, size: 0, readable: 'omitted' }
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile()) return { text: null, size: 0, readable: 'omitted' }
    // A second name for the same bytes can lead out of the folder, and the check above cannot see it.
    if (info.nlink > 1) return { text: null, size: 0, readable: 'omitted' }
    // The file that was opened must be the one the path leads to now, inside the folder: a folder
    // swapped for a link between the check and the open does not pass.
    try {
      const again = realpathSync(full)
      const now = statSync(again)
      if (
        (again !== join(real, path) && !again.startsWith(real + sep)) ||
        now.dev !== info.dev ||
        now.ino !== info.ino
      ) {
        return { text: null, size: 0, readable: 'omitted' }
      }
    } catch {
      return { text: null, size: 0, readable: 'omitted' }
    }
    if (info.size > limit) return { text: null, size: info.size, readable: 'large' }
    const buffer = Buffer.alloc(info.size)
    const read = readSync(fd, buffer, 0, info.size, 0)
    const bytes = buffer.subarray(0, read)
    if (bytes.subarray(0, 8192).includes(0)) return { text: null, size: info.size, readable: 'binary' }
    return { text: bytes.toString('utf8'), size: info.size, readable: 'text' }
  } finally {
    closeSync(fd)
  }
}

const STATUS: Record<string, FileStatus> = { M: 'M', T: 'M', A: 'A', D: 'D', '?': 'U' }

/** `git status --porcelain=v1 -z` without renames: two status letters, a space, a path. */
function statuses(text: string | null): Map<string, FileStatus> {
  const found = new Map<string, FileStatus>()
  for (const record of splitNul(text)) {
    const code = record.slice(0, 2)
    const path = record.slice(3)
    const letter = code[0] === '?' ? '?' : code[1] !== ' ' ? code[1] : code[0]
    const status = STATUS[letter ?? '']
    if (status && isSafeRelativePath(path)) found.set(path, status)
  }
  return found
}

interface Written {
  index: PublishedFiles
  texts: Map<string, string>
  diffs: Map<string, string>
}

async function build(directory: string, environment: string, now: number): Promise<Written | null> {
  let real: string
  try {
    real = realpathSync(directory)
  } catch {
    return null
  }
  return withRepository(directory, async (git) => {
    const [tracked, untracked, ignored, status, branch, log, counts] = await Promise.all([
      git(['ls-files', '-z', '--cached']),
      git(['ls-files', '-z', '--others', '--exclude-standard']),
      git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']),
      git(['status', '--porcelain=v1', '-z', '--no-renames', '--ignore-submodules=all', '--untracked-files=all']),
      git(['symbolic-ref', '--short', '-q', 'HEAD']),
      git(['log', '-1', '--no-show-signature', '--format=%h%x1f%s%x1f%ct']),
      git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    ])
    const changes = statuses(status)
    const deleted = [...changes].filter(([, value]) => value === 'D').map(([path]) => path)
    const names = new Set([...splitNul(tracked), ...splitNul(untracked)].filter(isSafeRelativePath))
    for (const path of deleted) names.add(path)

    const files: PublishedFile[] = []
    let truncated = false
    for (const path of [...names].sort()) {
      if (files.length >= FILES_MAX_ENTRIES) {
        truncated = true
        break
      }
      const info = lstatSync(join(real, path), { throwIfNoEntry: false })
      const state = changes.get(path) ?? null
      files.push({
        path,
        kind: !info ? 'file' : info.isSymbolicLink() ? 'link' : 'file',
        size: info?.isFile() ? info.size : null,
        status: state,
        ignored: false,
        readable: 'omitted',
        diff: state === 'M',
      })
    }
    for (const entry of splitNul(ignored)) {
      const path = entry.endsWith('/') ? entry.slice(0, -1) : entry
      if (!isSafeRelativePath(path) || files.length >= FILES_MAX_ENTRIES) continue
      files.push({
        path,
        kind: entry.endsWith('/') ? 'dir' : 'file',
        size: null,
        status: null,
        ignored: true,
        readable: 'omitted',
        diff: false,
      })
    }

    // The changed ones first, so that a project too big for the limits still shows what moved.
    const order = [...files].filter((file) => file.kind === 'file' && !file.ignored)
    order.sort((a, b) => Number(b.status !== null) - Number(a.status !== null) || a.path.localeCompare(b.path))
    const texts = new Map<string, string>()
    const diffs = new Map<string, string>()
    let total = 0
    for (const file of order) {
      if (isSecretPath(file.path)) {
        file.readable = 'hidden'
        file.diff = false
        continue
      }
      if (file.status === 'D') continue
      if (texts.size >= FILES_MAX_TEXTS || total >= FILES_MAX_TOTAL_BYTES) {
        truncated = true
        continue
      }
      const read = readText(real, file.path, FILES_MAX_TEXT_BYTES)
      file.readable = read.readable
      file.size = read.size || file.size
      if (read.text === null) {
        file.diff = false
        continue
      }
      texts.set(file.path, read.text)
      total += Buffer.byteLength(read.text)
      if (file.diff) {
        // No external diff driver, no textconv: both name a program git would run.
        const patch = await git(['diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-textconv', '--', file.path])
        // git read the file by its path, so it is checked again afterwards: still a single-name regular
        // file, and a patch that is about this path and no other.
        const still = lstatSync(join(real, file.path), { throwIfNoEntry: false })
        const headers = (patch ?? '').split('\n').filter((line) => line.startsWith('diff --git '))
        const aboutThisFile = headers.length === 1 && headers[0] === `diff --git a/${file.path} b/${file.path}`
        if (patch && patch.trim() !== '' && still?.isFile() && still.nlink === 1 && aboutThisFile) {
          diffs.set(file.path, patch.slice(0, FILES_MAX_DIFF_BYTES))
          total += Math.min(Buffer.byteLength(patch), FILES_MAX_DIFF_BYTES)
        } else file.diff = false
      }
    }

    const [hash, subject, at] = (log ?? '').trim().split('\x1f')
    const [, ahead] = (counts ?? '').trim().split(/\s+/).map(Number)
    const changed = [...changes.values()].filter((value) => value !== 'U').length
    return {
      index: {
        version: 1,
        environment,
        branch: (branch ?? '').trim() || null,
        head: hash ? { hash, subject: subject ?? '', at: Number(at) || 0 } : null,
        changed,
        untracked: [...changes.values()].filter((value) => value === 'U').length,
        ahead: counts !== null && Number.isFinite(ahead) ? (ahead as number) : null,
        collectedAt: Math.floor(now / 1000),
        truncated,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      },
      texts,
      diffs,
    }
  })
}

function sameOnDisk(path: string, text: string): boolean {
  try {
    return readFileSync(path, 'utf8') === text
  } catch {
    return false
  }
}

function publish(root: string, written: Written): void {
  const base = join(filesDir(root), written.index.environment)
  mkdirSync(join(base, 'blobs'), { recursive: true, mode: 0o755 })
  mkdirSync(join(base, 'diffs'), { recursive: true, mode: 0o755 })
  const keep = { blobs: new Set<string>(), diffs: new Set<string>() }
  for (const [path, text] of written.texts) {
    const key = fileKey(path)
    keep.blobs.add(key)
    if (!sameOnDisk(join(base, 'blobs', key), text)) writeAtomic(join(base, 'blobs', key), text)
  }
  for (const [path, text] of written.diffs) {
    const key = fileKey(path)
    keep.diffs.add(key)
    if (!sameOnDisk(join(base, 'diffs', key), text)) writeAtomic(join(base, 'diffs', key), text)
  }
  for (const kind of ['blobs', 'diffs'] as const) {
    for (const name of readdirSync(join(base, kind))) {
      if (!keep[kind].has(name) && !name.startsWith('.')) rmSync(join(base, kind, name), { force: true })
    }
  }
  writeAtomic(join(base, 'index.json'), `${JSON.stringify(written.index)}\n`)
}

/** Publishes the copy for one environment, at most every half minute. Never throws. */
export async function publishFiles(
  root: string,
  environment: string,
  directory: string,
  now = Date.now(),
): Promise<void> {
  if (!isFileEnvironmentName(environment)) return
  if (now - (last.get(environment) ?? 0) < CACHE_MS) return
  last.set(environment, now)
  try {
    const written = await build(directory, environment, now)
    if (written) publish(root, written)
    else rmSync(join(filesDir(root), environment), { recursive: true, force: true })
  } catch {
    // A copy that could not be made is a copy that is not there. Metrics go on.
  }
}

/** Removes the copies of environments that are not running here any more. */
export function pruneFiles(root: string, present: ReadonlySet<string>): void {
  const base = filesDir(root)
  if (!existsSync(base)) return
  for (const name of readdirSync(base)) {
    if (!present.has(name)) rmSync(join(base, name), { recursive: true, force: true })
  }
}
