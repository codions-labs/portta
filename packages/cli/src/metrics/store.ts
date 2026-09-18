import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  HISTORY_RETENTION_SECONDS,
  historyPointFrom,
  type MetricsInstance,
  type MetricsSnapshot,
  mergeHistoryLines,
} from 'portta-core'
import { currentFile, historyFile, instanceFile, logFile } from './paths.js'

const LOG_LIMIT_BYTES = 256 * 1024

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text, { mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export function loadInstance(root: string, hostname: string | null): MetricsInstance {
  const path = instanceFile(root)
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MetricsInstance>
      if (typeof parsed.id === 'string' && parsed.id !== '') {
        return {
          id: parsed.id,
          name: parsed.name ?? hostname,
          hostname: hostname ?? parsed.hostname ?? null,
        }
      }
    } catch {
      // Recreate below.
    }
  }
  const instance: MetricsInstance = {
    id: randomUUID(),
    name: hostname,
    hostname,
  }
  writeAtomic(path, `${JSON.stringify(instance, null, 2)}\n`)
  return instance
}

export function writeCurrent(root: string, snapshot: MetricsSnapshot): string {
  const path = currentFile(root)
  writeAtomic(path, `${JSON.stringify(snapshot, null, 2)}\n`)
  return path
}

export function appendHistory(root: string, snapshot: MetricsSnapshot): void {
  const path = historyFile(root)
  mkdirSync(dirname(path), { recursive: true })
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const merged = mergeHistoryLines(existing, historyPointFrom(snapshot), snapshot.collectedAt)
  writeAtomic(path, merged)
}

export function readCurrent(root: string): MetricsSnapshot | null {
  const path = currentFile(root)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MetricsSnapshot
  } catch {
    return null
  }
}

export function appendLog(root: string, line: string): void {
  const path = logFile(root)
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path) && statSync(path).size > LOG_LIMIT_BYTES) {
    renameSync(path, `${path}.old`)
  }
  writeFileSync(path, `${new Date().toISOString()} ${line}\n`, { flag: 'a', mode: 0o600 })
}

export { HISTORY_RETENTION_SECONDS }
