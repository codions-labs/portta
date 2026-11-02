// Projects Home is the one filesystem root of a Node. A managed Project lives
// at <home>/<relativePath>. Identity is not the path; the path is resolved
// from the Home so changing the Home does not invent new Projects.
//
// These helpers are lexical. realpath, directory listing and `du` belong on
// the host (CLI / collector). The panel must not open Projects Home itself.
// See docs/development/adr/0031-projects-home-and-project.md.

import { posix } from 'node:path'

export class ProjectsHomeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectsHomeError'
  }
}

/** Where a path sits relative to Projects Home, after any realpath the host supplied. */
export type ProjectLocation = 'managed' | 'external' | 'escaped' | 'missing' | 'inaccessible'

const HIDDEN = /^\./
const IGNORED_FIRST_LEVEL = new Set(['lost+found', 'node_modules', '.git'])

/** Default Home: next to the user's work, not inside PORTTA_HOME. */
export function defaultProjectsHome(userHome: string, isRoot: boolean): string {
  if (isRoot) return '/srv/projects'
  const home = userHome.replace(/\/+$/, '')
  if (home === '' || home === '/') return '/srv/projects'
  return `${home}/projects`
}

/**
 * Expand `~` and make the path absolute. Does not consult the filesystem.
 * Relative inputs are resolved against `cwd`.
 */
export function normalizeProjectsHome(input: string, cwd = '/', userHome = ''): string {
  const trimmed = input.trim()
  if (trimmed === '') {
    throw new ProjectsHomeError('Projects Home cannot be empty')
  }
  if (trimmed.includes('\0')) {
    throw new ProjectsHomeError('refusing a Projects Home with a NUL')
  }
  let expanded = trimmed
  if (expanded === '~') expanded = userHome || '/'
  else if (expanded.startsWith('~/')) {
    const base = userHome.replace(/\/+$/, '') || '/'
    expanded = `${base}/${expanded.slice(2)}`
  }
  const absolute = expanded.startsWith('/') ? expanded : posix.join(cwd, expanded)
  const normalized = posix.normalize(absolute)
  if (normalized.split('/').includes('..') || !normalized.startsWith('/')) {
    throw new ProjectsHomeError('refusing a Projects Home that walks up')
  }
  if (normalized === '/') {
    throw new ProjectsHomeError('refusing the filesystem root as Projects Home')
  }
  return normalized
}

/**
 * The stored location of a managed Project: a relative path of any depth that
 * stays inside the Home (`group/project`). Never absolute, never `..`, and no
 * hidden segment.
 */
export function parseRelativeProjectPath(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new ProjectsHomeError('relative path cannot be empty')
  }
  if (trimmed.includes('\0')) {
    throw new ProjectsHomeError('refusing a relative path with a NUL')
  }
  if (trimmed.startsWith('/')) {
    throw new ProjectsHomeError('a managed Project stores a path relative to Projects Home')
  }
  const normalized = posix.normalize(trimmed).replace(/^\/+/, '')
  if (normalized === '' || normalized === '.' || normalized === '..') {
    throw new ProjectsHomeError('refusing a relative path that resolves to the Home itself')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '')) {
    throw new ProjectsHomeError('refusing a relative path that walks up')
  }
  if (parts.some((part) => HIDDEN.test(part))) {
    throw new ProjectsHomeError('refusing a hidden directory as a managed Project')
  }
  return parts.join('/')
}

/** Effective path of a managed Project, lexical only. */
export function resolveProjectPath(home: string, relativePath: string): string {
  const normalizedHome = normalizeProjectsHome(home)
  const relative = parseRelativeProjectPath(relativePath)
  return posix.join(normalizedHome, relative)
}

/**
 * True when `absolutePath` is lexically inside `home` (or is `home`).
 * Callers who have realpath results should pass those, not the raw strings.
 */
export function isDescendantPath(home: string, absolutePath: string): boolean {
  const parent = posix.normalize(home)
  const child = posix.normalize(absolutePath)
  if (parent === '/' || !parent.startsWith('/') || !child.startsWith('/')) return false
  return child === parent || child.startsWith(`${parent}/`)
}

/**
 * Classify a candidate after the host has optionally resolved both sides.
 * A symlink that realpath'd outside the Home is `escaped`, never `managed`.
 */
export function classifyProjectLocation(input: {
  home: string
  path: string
  homeRealpath?: string | null
  pathRealpath?: string | null
  readable?: boolean
}): ProjectLocation {
  if (input.readable === false) return 'inaccessible'
  if (input.pathRealpath === null) return 'missing'
  if (input.homeRealpath === null) return 'missing'

  const home = input.homeRealpath ?? posix.normalize(input.home)
  const path = input.pathRealpath ?? posix.normalize(input.path)
  if (!home.startsWith('/') || !path.startsWith('/')) return 'inaccessible'

  if (isDescendantPath(home, path) && path !== home) {
    const relative = path.slice(home.length).replace(/^\/+/, '')
    const first = relative.split('/')[0] ?? ''
    if (first !== '' && !HIDDEN.test(first) && !IGNORED_FIRST_LEVEL.has(first)) {
      return 'managed'
    }
  }

  const lexicalHome = posix.normalize(input.home)
  const lexicalPath = posix.normalize(input.path)
  if (isDescendantPath(lexicalHome, lexicalPath) && path !== home) {
    return 'escaped'
  }
  return 'external'
}
