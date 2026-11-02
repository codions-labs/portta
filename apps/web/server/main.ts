// The panel, as one process.
//
// Boot order matters and is the point of this file: configuration, then the
// database (a failure here is a failure to start), then Docker and the caches,
// then Next, then the dispatcher, then listen, then the jobs. Nothing serves a
// request until everything it might need exists.

import { createServer } from 'node:http'
import next from 'next'
import { ConfigError, createAuth, createPrincipalResolver, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import {
  type AppDeps,
  consoleRoute,
  createApp,
  createMaintenance,
  createSnapshotCache,
  createUpgradeHandler,
  createVerdictCache,
  Database,
  DockerClient,
  LiveHub,
  loadConfig,
  logStreamRoute,
} from 'portta-server'
import { WebSocketServer } from 'ws'
import { registerDeps } from '../lib/server/deps.ts'
import { registerPrincipals } from '../lib/server/principal-registry.ts'
import { createPortta, type Startable } from './compose.ts'

const config = loadConfig()
const development = process.env.NODE_ENV !== 'production'

// Before anything else, because it can refuse to start: `disabled` on an
// address other than loopback is an open panel on a network, which is a
// configuration mistake rather than something to warn about and carry on with.
let security: ReturnType<typeof resolveSecurityMode>
try {
  security = resolveSecurityMode(process.env)
} catch (error) {
  if (!(error instanceof ConfigError)) throw error
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}

// The database is a boot dependency, not a soft one. A panel that starts
// without it can show Docker and nothing else, and every write it accepts is
// lost — so it says what is missing and stops, rather than degrading into a
// half-panel somebody has to diagnose. There is nothing to configure: the file
// is created on first open (ADR 0037), so the only way this fails is a
// directory the panel cannot write to.
const db = Database.open(config.databaseFile)
try {
  await db.initialize()
  process.stdout.write(`database ready: ${db.status().migrations.join(', ') || 'no migrations'}\n`)
} catch (error) {
  process.stderr.write(`the panel cannot open ${config.databaseFile}: ${String(error)}\n`)
  process.exit(1)
}

const client = new DockerClient(config.dockerApi)

const cache = createSnapshotCache(client, config, 1000, (snapshot) => db.recordEnvironmentsSeen(snapshot.environments))
const hub = new LiveHub(client, cache)
const verdict = createVerdictCache(config)

// Better Auth is built only when there is something to sign in to. In open
// mode it is never constructed: every request is already the local operator,
// and an unused login page is a door with no lock and no wall.
const auth =
  security.mode === 'protected' ? createAuth({ db: db.handle, security, hasOwner: () => hasOwner(db.handle) }) : null

const principals = createPrincipalResolver({
  security,
  db: db.handle,
  auth,
})

const deps: AppDeps = { config, client, cache, hub, verdict, db, security, auth, principals }

// Before `next.prepare()`: a page rendered during preparation would otherwise
// find nothing registered. See lib/server/deps.ts for why this is a global.
registerDeps(deps)
registerPrincipals(principals)

// `process.cwd()` is apps/web: `npm run dev`, `next build` and the image's
// WORKDIR all agree on it, and the bundled entry point has no directory of its
// own that Next could read `.next` and `next.config.ts` from.
const app = next({ dev: development, turbopack: development, dir: process.cwd() })
await app.prepare()

// The hourly housekeeping: expired tokens and old audit entries are pruned.
const jobs: Startable[] = [hub, createMaintenance(db)]

// The WebSocket half of the panel. One server, no port of its own: it never
// listens, it only takes sockets the upgrade handler has already authorised.
const sockets = new WebSocketServer({ noServer: true })
const wsUpgrade = createUpgradeHandler({
  principals,
  routes: [logStreamRoute(deps), consoleRoute(deps)],
  server: sockets,
  trustedOrigins: security.trustedOrigins,
})

const portta = createPortta({
  api: createApp(deps),
  documentation: config,
  next: app.getRequestHandler(),
  nextUpgrade: development ? app.getUpgradeHandler() : undefined,
  wsUpgrade,
  jobs,
  close: async () => {
    for (const socket of sockets.clients) socket.close(1001, 'the panel is shutting down')
    sockets.close()
    await db.close()
  },
})

const server = createServer(portta.handle)
server.on('upgrade', portta.upgrade)

server.listen(config.port, config.host, () => {
  process.stdout.write(`portta panel ${config.panelVersion} listening on http://${config.host}:${config.port}\n`)
  process.stdout.write(`docker api: ${config.dockerApi}\n`)
  process.stdout.write(`authentication: ${security.mode}\n`)
  if (security.mode === 'protected') {
    void hasOwner(db.handle).then((owner) => {
      if (!owner) process.stdout.write(`open ${security.panelUrl.origin}/setup to create the owner\n`)
    })
  }
  portta.start()
})

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal}: shutting the panel down\n`)
  void portta.stop().finally(() => {
    server.close(() => process.exit(0))
    // A connection that will not close must not hold the panel open forever.
    setTimeout(() => process.exit(0), 3000).unref()
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
