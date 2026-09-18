// `portta host serve`, as the process the CLI starts.
//
// Bundled beside the CLI as `dist/host.js` and started as a child of it, so the
// daemon is a process of its own: it can run in the foreground, under a service
// manager, or detached, without the CLI staying in memory.

import { hostListen } from './config.ts'
import { startHost } from './main.ts'
import { HOST_MODULES } from './modules/index.ts'
import { hostTokenFile, readOrCreateToken, resolveHostStateDir } from './token.ts'

const env = process.env
const stateDir = resolveHostStateDir(env.PORTTA_ROOT || process.cwd(), env)
const token = readOrCreateToken(hostTokenFile(stateDir))
const modules = HOST_MODULES
const running = await startHost({ ...hostListen(env), token, modules, context: { stateDir, env } })

process.stdout.write(`portta host daemon listening on ${running.url}\n`)
process.stdout.write(`token: ${hostTokenFile(stateDir)}\n`)
process.stdout.write(`modules: ${modules.map((module) => module.manifest.id).join(', ') || 'none'}\n`)

function shutdown(signal: string): void {
  process.stdout.write(`${signal}: stopping the host daemon\n`)
  void running.close().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
