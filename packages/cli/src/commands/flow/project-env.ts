import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { taskflowConfigEnvPath } from 'portta-host/taskflow/adapters/taskflow-paths'

// The launch project's env files, loaded before a command that runs the
// Taskflow runtime in-process (.env.local overrides .env).

/** Load a `.env` file from CWD into `process.env`, returning the keys it added.
 *  Those keys are the launch project's env: taskflow tracks them so it can keep
 *  them out of the tmux server's *global* environment (see PORTTA_FLOW_PROJECT_ENV_KEYS),
 *  where they would otherwise leak into every project's sessions and panes. */
async function loadEnvFile(path: string): Promise<string[]> {
  if (!existsSync(path)) return []
  const added: string[] = []
  const lines = (await readFile(path, 'utf8')).split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (!(key in process.env)) {
      process.env[key] = val
      added.push(key)
    }
  }
  return added
}

/** Load the launch project's `.env.local` and `.env`, then Taskflow's global
 *  config env, returning every key that was added. */
export async function loadProjectEnv(cwd: string = process.cwd()): Promise<Set<string>> {
  const projectEnvKeys = new Set<string>()
  for (const key of await loadEnvFile(resolve(cwd, '.env.local'))) projectEnvKeys.add(key)
  for (const key of await loadEnvFile(resolve(cwd, '.env'))) projectEnvKeys.add(key)

  // Taskflow's global config env (`~/.portta/.env`): machine-wide
  // secrets like LINEAR_API_KEY the single service reads regardless of which
  // directory it runs from. Loaded last so an already-set value wins — the unit
  // and the launch project's `.env` both take precedence. Its keys join
  // projectEnvKeys so they're stripped from the tmux global environment like any
  // other secret taskflow loads, rather than leaking into every session and pane.
  for (const key of await loadEnvFile(taskflowConfigEnvPath())) projectEnvKeys.add(key)
  return projectEnvKeys
}
