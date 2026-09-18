// Resources belong to one invocation. Never discover/reuse another run's DB.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

/**
 * A database for one run, and nothing to clean up but a directory.
 *
 * The panel database is a SQLite file (ADR 0037), so the fixture is a file: no
 * Docker, no port, no ownership check, and a run that cannot collide with
 * another one because the path is its own.
 */
export async function startDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'portta-e2e-db-'))
  return {
    file: join(directory, 'portta.db'),
    close: async () => rm(directory, { recursive: true, force: true }),
  }
}

export async function startPanel({ mode = 'disabled', fixture, env = {} } = {}) {
  const database = await startDatabase()
  let child
  let startupError
  let output = ''
  const close = async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            /* already exited */
          }
        }
      }, 5000)
      await exited
      clearTimeout(timer)
    }
    await database.close()
  }
  try {
    const port = await freePort(),
      enginePort = await freePort()
    const url = `http://127.0.0.1:${port}`,
      engineURL = `http://127.0.0.1:${enginePort}`
    const started = performance.now()
    child = spawn(process.execPath, [join(import.meta.dirname, 'harness.mjs')], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ...env,
        PORTTA_E2E_DATABASE_FILE: database.file,
        PORTTA_E2E_PANEL_PORT: String(port),
        PORTTA_E2E_DOCKER_PORT: String(enginePort),
        PORTTA_E2E_AUTH_MODE: mode,
        ...(fixture ? { PORTTA_E2E_FIXTURE: fixture } : {}),
      },
    })
    child.on('error', (error) => {
      startupError = error
      output += error.message
    })
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupError) throw startupError
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Panel exited during startup:\n${output}`)
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) })
        // The owned process must have reported its successful listen callback.
        // A health response from an unrelated process winning the port race
        // cannot make this fixture reuse that server.
        if (response.ok && output.includes(`listening on ${url}`) && child.exitCode === null) {
          console.log(
            `E2E panel startup (includes migrations/seed): ${((performance.now() - started) / 1000).toFixed(3)}s`,
          )
          return { url, engineURL, close, logs: () => output }
        }
      } catch {
        /* bounded readiness wait */
      }
      await pause(250)
    }
    throw new Error(`Panel did not become ready:\n${output}`)
  } catch (error) {
    await close()
    throw error
  }
}
