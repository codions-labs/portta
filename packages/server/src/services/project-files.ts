// The copy of a project's files, read from where the collector published it.
//
// The panel opens nothing of the project's. It reads state/files/<environment>/, which the collector
// writes on the host with secrets left out, and it checks what it reads again: the environment must
// be one of the project's, the path must be in the index and readable, and the file it opens is
// named by a hash of that path, never by the request.

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import {
  FILES_MAX_DIFF_BYTES,
  FILES_MAX_TEXT_BYTES,
  fileKey,
  isFileEnvironmentName,
  isSafeRelativePath,
  isSecretPath,
  type PublishedFiles,
} from 'portta-core'
import { z } from 'portta-core/zod'
import type { PanelConfig } from '../config.ts'

const Published = z.object({
  version: z.literal(1),
  environment: z.string(),
  branch: z.string().nullable(),
  head: z.object({ hash: z.string(), subject: z.string(), at: z.number() }).nullable(),
  changed: z.number(),
  untracked: z.number(),
  ahead: z.number().nullable(),
  collectedAt: z.number(),
  truncated: z.boolean(),
  files: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(['file', 'dir', 'link']),
      size: z.number().nullable(),
      status: z.enum(['M', 'A', 'D', 'U']).nullable(),
      ignored: z.boolean(),
      readable: z.enum(['text', 'hidden', 'binary', 'large', 'omitted']),
      diff: z.boolean(),
    }),
  ),
})

/** At most `limit` bytes of a regular file, opened without following a link. */
function readSmall(path: string, limit: number): string | null {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return null
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > limit) return null
    const buffer = Buffer.alloc(info.size)
    return buffer.subarray(0, readSync(fd, buffer, 0, info.size, 0)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

export function readFilesIndex(config: PanelConfig, environment: string): PublishedFiles | null {
  if (!isFileEnvironmentName(environment)) return null
  const text = readSmall(join(config.filesDir, environment, 'index.json'), 16 * 1024 * 1024)
  if (text === null) return null
  try {
    const parsed = Published.safeParse(JSON.parse(text))
    return parsed.success && parsed.data.environment === environment ? (parsed.data as PublishedFiles) : null
  } catch {
    return null
  }
}

export interface FileContent {
  content: string
  diff: string | null
}

/** Null when the path is not one the copy holds text for. */
export function readFileContent(config: PanelConfig, environment: string, path: string): FileContent | null {
  if (!isSafeRelativePath(path) || isSecretPath(path)) return null
  const index = readFilesIndex(config, environment)
  const entry = index?.files.find((file) => file.path === path)
  if (!entry || entry.kind !== 'file' || entry.ignored || entry.readable !== 'text') return null
  const key = fileKey(path)
  const content = readSmall(join(config.filesDir, environment, 'blobs', key), FILES_MAX_TEXT_BYTES)
  if (content === null) return null
  const diff = entry.diff ? readSmall(join(config.filesDir, environment, 'diffs', key), FILES_MAX_DIFF_BYTES) : null
  return { content, diff }
}
