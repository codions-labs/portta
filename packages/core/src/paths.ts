// Paths the runner may delete. The working directory comes from Docker's own
// label, never from a string the panel invented, but a label can still be
// `../etc` or `/`. This is the bound: absolute, no walk-up, not the root,
// not a top-level directory.

import { posix } from 'node:path'

export class PathRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathRefused'
  }
}

/**
 * The host path Compose recorded, if it is a directory the runner may remove.
 *
 * The check is lexical. The runner still resolves the path through `/host`
 * before `rm`, so a symlink cannot walk outside the host mount.
 */
export function assertRemovableWorkingDir(workingDir: string): string {
  if (typeof workingDir !== 'string' || workingDir.trim() === '') {
    throw new PathRefused('directory removal needs an absolute working directory')
  }
  if (workingDir.includes('\0')) {
    throw new PathRefused('refusing a working directory with a NUL')
  }
  if (!workingDir.startsWith('/')) {
    throw new PathRefused('refusing a relative working directory')
  }
  const parts = workingDir.split('/')
  if (parts.includes('..')) {
    throw new PathRefused('refusing a working directory that walks up')
  }
  const normalized = posix.normalize(workingDir)
  if (normalized.split('/').includes('..') || !normalized.startsWith('/')) {
    throw new PathRefused('refusing a working directory that walks up')
  }
  if (normalized === '/') {
    throw new PathRefused('refusing to remove the filesystem root')
  }
  if (normalized.split('/').filter((part) => part.length > 0).length < 2) {
    throw new PathRefused('refusing to remove a top-level directory')
  }
  return normalized
}
