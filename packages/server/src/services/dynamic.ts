// The files the panel is allowed to write into Traefik's dynamic
// configuration directory.
//
// The directory is mounted read-write, which makes the panel able to configure
// Traefik. That capability is bounded by name rather than by intention: a write
// to any other path is refused here, before it happens, the way
// docker/allowlist.ts refuses a Docker call. Everything else in the directory
// (middlewares.yaml, tcp.yaml, local-tls.yaml, anything a user dropped in)
// belongs to the user and is never touched.
//
// The list is three fixed names.
//
// See docs/development/adr/0011-bounded-traefik-write-surface.md.

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/** The fixed part of the write surface. Nothing is added here without an ADR. */
export const GENERATED_FILES = {
  shares: 'portta-shares.yaml',
  aliases: 'portta-aliases.yaml',
  auth: 'portta-auth.yaml',
} as const

const ALLOWED: readonly string[] = Object.values(GENERATED_FILES)

export class DynamicWriteRefused extends Error {
  status = 403
  hint: string
  constructor(message: string, hint = 'this is a panel limit, not a filesystem one') {
    super(message)
    this.name = 'DynamicWriteRefused'
    this.hint = hint
  }
}

export function assertGenerated(name: string): void {
  if (!ALLOWED.includes(name)) {
    throw new DynamicWriteRefused(`the panel only writes ${ALLOWED.join(', ')} in Traefik's dynamic directory`)
  }
}

export function dynamicPath(dir: string, name: string): string {
  assertGenerated(name)
  return join(dir, name)
}

export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function readGenerated(dir: string, name: string): string | null {
  const path = dynamicPath(dir, name)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes through a temporary file in the same directory, so Traefik's watcher
 * never sees a half-written router. Mode 600 keeps runtime routing state private.
 */
export function writeGenerated(dir: string, name: string, contents: string): void {
  const path = dynamicPath(dir, name)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const temporary = join(dir, `.portta-${name}.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, contents, { mode: 0o600 })
    renameSync(temporary, path)
  } catch (cause) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      /* nothing else to do */
    }
    throw cause
  }
}
