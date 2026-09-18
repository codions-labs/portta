import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { resolveHostTool } from './host-tools.ts'

export interface RunResult {
  success: boolean
  stdout: Buffer
  stderr: Buffer
}

/** Run a command synchronously and capture its output. Shared by the CLI
 *  (re-exported from bin/src/shared.ts) and backend code that needs to shell
 *  out (e.g. repo detection for project setup). */
export function run(cmd: string, args: string[], opts?: { cwd?: string }): RunResult {
  const resolved = resolveHostTool(cmd) ?? cmd
  const result = spawnSync(resolved, args, {
    ...opts,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    success: result.status === 0 && !result.error,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
  }
}

export function resolveExecutablePath(tool: string): string | null {
  return resolveHostTool(tool)
}

export function which(tool: string): boolean {
  return resolveExecutablePath(tool) !== null
}

export function getGitRoot(): string | null {
  const result = run('git', ['rev-parse', '--show-toplevel'])
  if (!result.success) return null
  return result.stdout.toString().trim()
}

export function detectProjectName(gitRoot: string): string {
  const pkgPath = join(gitRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.name) return pkg.name
    } catch {} // malformed package.json, fall back to dir name
  }
  return basename(gitRoot)
}
