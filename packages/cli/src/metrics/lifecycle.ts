import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import {
  COLLECT_INTERVAL_MS,
  ENVIRONMENT_COLLECT_INTERVAL_MS,
  HISTORY_INTERVAL_MS,
  REPOS_SCAN_INTERVAL_MS,
} from 'portta-core'
import { scanRepositories } from '../commands/repos.js'
import { collectEnvironmentReport } from '../environment/index.js'
import { collectHostSecurityReport, hostSecurityContext } from '../environment/security/index.js'
import { writeHostSecurityReport } from '../environment/security/store.js'
import { writeEnvironmentReport } from '../environment/store.js'
import { spawnDetached } from '../process.js'
import { collectSnapshot } from './collect.js'
import { pidFile } from './paths.js'
import { appendHistory, appendLog, writeAtomic, writeCurrent } from './store.js'

export function readCollectorPid(root: string): number | null {
  const path = pidFile(root)
  if (!existsSync(path)) return null
  const parsed = Number(readFileSync(path, 'utf8').trim())
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function commandLine(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
  } catch {
    return ''
  }
}

export function pidIsCollector(pid: number): boolean {
  const line = commandLine(pid)
  if (line === '') return true
  return line.includes('host') && line.includes('watch')
}

export function collectorRunning(root: string): number | null {
  const pid = readCollectorPid(root)
  if (pid === null) return null
  if (!pidAlive(pid) || !pidIsCollector(pid)) {
    clearPid(root)
    return null
  }
  return pid
}

export function clearPid(root: string): void {
  const path = pidFile(root)
  if (existsSync(path)) unlinkSync(path)
}

export function writePid(root: string, pid: number): void {
  writeAtomic(pidFile(root), `${pid}\n`)
}

export function cliInvocation(): { file: string; args: string[] } {
  const script = process.argv[1]
  return { file: process.execPath, args: script ? [script] : [] }
}

export function startCollector(root: string, profile?: string): { pid: number | null; started: boolean } {
  const existing = collectorRunning(root)
  if (existing !== null) return { pid: existing, started: false }
  const { file, args } = cliInvocation()
  const profileArgs = profile ? ['--profile', profile] : []
  const pid = spawnDetached(file, [...args, ...profileArgs, 'host', 'watch', '--loop'], {
    cwd: root,
    env: { ...process.env, PORTTA_ROOT: root },
  })
  if (pid === undefined) return { pid: null, started: false }
  writePid(root, pid)
  return { pid, started: true }
}

export function stopCollector(root: string): boolean {
  const pid = readCollectorPid(root)
  clearPid(root)
  if (pid === null || !pidAlive(pid)) return false
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface CollectorLoopDeps {
  /** The repository scan, so the loop can be driven in a test without git or Docker. */
  scan: () => Promise<unknown>
}

export async function runCollectorLoop(
  root: string,
  deps: CollectorLoopDeps = { scan: () => scanRepositories({}) },
  profile?: string,
): Promise<void> {
  writePid(root, process.pid)
  appendLog(root, `collector started pid=${process.pid}`)
  let lastHistory = 0
  let lastScan = 0
  let lastEnvironment = 0
  let running = true
  const halt = () => {
    running = false
  }
  process.on('SIGTERM', halt)
  process.on('SIGINT', halt)

  while (running) {
    const started = Date.now()
    try {
      const snapshot = await collectSnapshot(root, started)
      writeCurrent(root, snapshot)
      if (started - lastHistory >= HISTORY_INTERVAL_MS || lastHistory === 0) {
        appendHistory(root, snapshot)
        lastHistory = started
      }
    } catch (error) {
      appendLog(root, `collect failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Repositories change slower than load does: once a minute is enough for
    // a branch switch or a commit to show up, and cheap enough to never matter.
    if (started - lastScan >= REPOS_SCAN_INTERVAL_MS || lastScan === 0) {
      lastScan = started
      try {
        await deps.scan()
      } catch (error) {
        appendLog(root, `repository scan failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (started - lastEnvironment >= ENVIRONMENT_COLLECT_INTERVAL_MS || lastEnvironment === 0) {
      lastEnvironment = started
      try {
        const [environment, security] = await Promise.all([
          collectEnvironmentReport(),
          collectHostSecurityReport(root, undefined, hostSecurityContext(root, profile)),
        ])
        writeEnvironmentReport(root, environment)
        writeHostSecurityReport(root, security)
      } catch (error) {
        appendLog(root, `environment collect failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const elapsed = Date.now() - started
    const wait = Math.max(0, COLLECT_INTERVAL_MS - elapsed)
    if (!running) break
    await sleep(wait)
  }
  clearPid(root)
  appendLog(root, 'collector stopped')
}
