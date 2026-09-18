// Sync Node fs APIs on purpose so writes flush
// from synchronous startup/shutdown paths where asynchronous writes would not.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isProjectEntry, type ProjectEntry } from 'portta-core/taskflow'
import { globalPaths } from 'portta-core/taskflow/paths'
import { log } from '../lib/log.ts'

export interface ProjectsRegistry {
  /** All known, well-formed project entries, in insertion order. */
  list(): ProjectEntry[]
  /** Upsert by `path`: an existing entry with the same path is replaced. */
  add(entry: ProjectEntry): void
  /** Remove the entry for `path`, if present. */
  remove(path: string): void
}

function defaultRegistryFile(): string {
  return globalPaths().projectsRegistry
}

export function createProjectsRegistry(file: string = defaultRegistryFile()): ProjectsRegistry {
  function read(): ProjectEntry[] {
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      log.debug(`[projects-registry] ignoring malformed ${file}`)
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isProjectEntry)
  }

  function write(entries: ProjectEntry[]): void {
    mkdirSync(dirname(file), { recursive: true })
    const tmpPath = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(entries, null, 2)}\n`)
    renameSync(tmpPath, file)
  }

  return {
    list(): ProjectEntry[] {
      return read()
    },

    add(entry: ProjectEntry): void {
      const entries = read().filter((existing) => existing.path !== entry.path)
      entries.push(entry)
      write(entries)
    },

    remove(path: string): void {
      const entries = read()
      const next = entries.filter((entry) => entry.path !== path)
      if (next.length !== entries.length) write(next)
    },
  }
}
