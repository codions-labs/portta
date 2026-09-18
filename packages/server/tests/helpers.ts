// Fixtures for the API tests: a fake Docker host built from plain objects, so
// every test states exactly the situation it is about.

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { createAuth, createPrincipalResolver, hasOwner, resolveSecurityMode } from 'portta-auth-core'
import {
  type Db,
  environments as environmentsTable,
  projects as projectsTable,
  repositories as repositoriesTable,
} from 'portta-db'
import { createTestDb, resetTestDb, type TestDb } from 'portta-db/testing'
import { afterAll } from 'vitest'
import { createApp } from '../src/api/index.ts'
import { loadConfig, type PanelConfig } from '../src/config.ts'
import { Database } from '../src/db/index.ts'
import { LiveHub } from '../src/realtime/hub.ts'
import type { DockerClient, LogLine } from '../src/services/docker/client.ts'
import type {
  DockerContainerInspect,
  DockerContainerListItem,
  DockerInfo,
  DockerNetwork,
  DockerVersion,
} from '../src/services/docker/types.ts'
import { createSnapshotCache } from '../src/services/inventory.ts'
import { type ForgeClient, type ForgeRequest, ForgeUnavailable } from '../src/services/issues/host-client.ts'
import { createVerdictCache } from '../src/services/traefik.ts'

export interface FakeContainer {
  id: string
  name: string
  image: string
  state?: string
  labels?: Record<string, string>
  networks?: string[]
  exposed?: number[]
  published?: { hostIp: string; hostPort: number; containerPort: number }[]
  health?: 'healthy' | 'unhealthy' | 'starting'
  mounts?: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }[]
  startedAt?: string
  // A one-shot container is described by how it ended, not by whether it runs.
  // Without these two a fixture cannot say "exited with 2 at 10:05".
  exitCode?: number
  finishedAt?: string
  /** Docker's restart policy name; `no` when unset, as Docker reports it. */
  restartPolicy?: string
  env?: string[]
}

export function container(spec: FakeContainer): {
  item: DockerContainerListItem
  inspect: DockerContainerInspect
} {
  const state = spec.state ?? 'running'
  const labels = spec.labels ?? {}
  const networks = Object.fromEntries((spec.networks ?? ['bridge']).map((name) => [name, {}]))
  const ports: Record<string, { HostIp?: string; HostPort?: string }[] | null> = {}
  for (const port of spec.exposed ?? []) ports[`${port}/tcp`] = null
  for (const binding of spec.published ?? []) {
    ports[`${binding.containerPort}/tcp`] = [{ HostIp: binding.hostIp, HostPort: String(binding.hostPort) }]
  }

  const item: DockerContainerListItem = {
    Id: spec.id,
    Names: [`/${spec.name}`],
    Image: spec.image,
    ImageID: `sha256:${spec.id}`,
    Command: 'run',
    Created: 1_700_000_000,
    State: state,
    Status: state === 'running' ? 'Up 3 hours' : 'Exited (0) 3 hours ago',
    Labels: labels,
    Ports: [],
    NetworkSettings: { Networks: networks },
    Mounts: spec.mounts ?? [],
  }

  const inspect: DockerContainerInspect = {
    Id: spec.id,
    Name: `/${spec.name}`,
    Created: '2026-01-01T00:00:00Z',
    RestartCount: 0,
    State: {
      Status: state,
      Running: state === 'running',
      ExitCode: spec.exitCode ?? (state === 'running' ? 0 : 1),
      StartedAt: spec.startedAt ?? '2026-01-01T00:00:00Z',
      FinishedAt: spec.finishedAt ?? '0001-01-01T00:00:00Z',
      ...(spec.health ? { Health: { Status: spec.health, FailingStreak: 0 } } : {}),
    },
    Config: {
      Image: spec.image,
      Labels: labels,
      ExposedPorts: Object.fromEntries(
        [...(spec.exposed ?? []), ...(spec.published ?? []).map((p) => p.containerPort)].map((p) => [`${p}/tcp`, {}]),
      ),
      Tty: false,
      Env: spec.env ?? [],
    },
    HostConfig: { RestartPolicy: { Name: spec.restartPolicy ?? 'no' } },
    NetworkSettings: { Ports: ports, Networks: networks },
    Mounts: spec.mounts ?? [],
  }

  return { item, inspect }
}

export interface FakeDockerOptions {
  containers?: FakeContainer[]
  networks?: Partial<DockerNetwork>[]
  logs?: LogLine[]
  /** Per container: lines to return, or an Error the read should reject with. */
  logsByContainer?: Record<string, LogLine[] | Error>
  failInspect?: string[]
  fail?: Partial<Record<'start' | 'stop' | 'restart', string[]>>
}

export interface FakeDocker {
  client: DockerClient
  calls: { method: string; args: unknown[] }[]
  removed: string[]
  created: unknown[]
}

export function fakeDocker(options: FakeDockerOptions = {}): FakeDocker {
  const built = (options.containers ?? []).map(container)
  const calls: { method: string; args: unknown[] }[] = []
  const removed: string[] = []
  const created: unknown[] = []

  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })

  const networks: DockerNetwork[] = (
    options.networks ?? [
      { Name: 'portta', Labels: { 'portta.managed': 'true' } },
      { Name: 'portta-control', Internal: true, Labels: { 'portta.managed': 'true' } },
    ]
  ).map((network, index) => ({
    Id: network.Id ?? `net${index}`,
    Name: network.Name ?? `net${index}`,
    Driver: network.Driver ?? 'bridge',
    Scope: network.Scope ?? 'local',
    Internal: network.Internal ?? false,
    Labels: network.Labels ?? {},
    Containers: network.Containers ?? {},
  }))

  const client = {
    async ping() {
      return true
    },
    async version(): Promise<DockerVersion> {
      return { Version: '29.4.0', ApiVersion: '1.51', Os: 'linux', Arch: 'arm64' }
    },
    async info(): Promise<DockerInfo> {
      const running = built.filter((entry) => entry.item.State === 'running').length
      return {
        Name: 'test-host',
        Containers: built.length,
        ContainersRunning: running,
        ContainersPaused: 0,
        ContainersStopped: built.length - running,
        Images: 12,
        NCPU: 8,
        MemTotal: 17_179_869_184,
        OperatingSystem: 'Test Linux',
        Architecture: 'aarch64',
        ServerVersion: '29.4.0',
      }
    },
    async listContainers() {
      record('listContainers')
      return built.map((entry) => entry.item)
    },
    async inspect(id: string) {
      if ((options.failInspect ?? []).includes(id)) throw new Error('no such container')
      const found = built.find((entry) => entry.item.Id === id)
      if (!found) throw new Error('no such container')
      return found.inspect
    },
    async listNetworks() {
      return networks
    },
    async inspectNetwork(id: string) {
      return networks.find((network) => network.Id === id) ?? networks[0]!
    },
    async start(id: string) {
      record('start', id)
      if ((options.fail?.start ?? []).includes(id)) throw new Error(`start failed: ${id}`)
    },
    async stop(id: string) {
      record('stop', id)
      if ((options.fail?.stop ?? []).includes(id)) throw new Error(`stop failed: ${id}`)
    },
    async restart(id: string) {
      record('restart', id)
      if ((options.fail?.restart ?? []).includes(id)) throw new Error(`restart failed: ${id}`)
    },
    async remove(id: string, force: boolean) {
      record('remove', id, force)
      removed.push(id)
    },
    async stats() {
      return {
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
        memory_stats: { usage: 1024 * 1024 * 64, limit: 1024 * 1024 * 512, stats: {} },
      }
    },
    async logs(id: string, logOptions?: { tail?: number }) {
      record('logs', id, logOptions)
      const specific = options.logsByContainer?.[id]
      if (specific instanceof Error) throw specific
      if (specific) return specific
      return (
        options.logs ?? [
          { stream: 'stdout' as const, timestamp: '2026-01-01T00:00:01Z', text: 'hello' },
          { stream: 'stderr' as const, timestamp: '2026-01-01T00:00:02Z', text: 'boom' },
        ]
      )
    },
    /**
     * A stream that ends, so a follower's loop terminates.
     *
     * The real one is held open by Docker until the container stops or the
     * caller aborts. A fake that never ends would make every test that follows
     * it hang, so this delivers what it has and closes — which is exactly what
     * a stopped container does.
     */
    async followLogs(id: string, followOptions: { tail?: number; signal: AbortSignal }) {
      record('followLogs', id, { tail: followOptions.tail })
      const specific = options.logsByContainer?.[id]
      if (specific instanceof Error) throw specific
      const lines = specific ??
        options.logs ?? [
          { stream: 'stdout' as const, timestamp: '2026-01-01T00:00:01Z', text: 'hello' },
          { stream: 'stderr' as const, timestamp: '2026-01-01T00:00:02Z', text: 'boom' },
        ]
      const text = lines.map((line) => `${line.timestamp ?? ''} ${line.text}\n`).join('')
      return {
        multiplexed: false,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text))
            controller.close()
          },
        }),
      }
    },
    async createBridge(spec: unknown) {
      record('createBridge', spec)
      created.push(spec)
      return 'bridge-container-id'
    },
    async *events() {
      // The tests drive the hub directly.
    },
  } as unknown as DockerClient

  return { client, calls, removed, created }
}

export function testConfig(overrides: Partial<PanelConfig> = {}): PanelConfig {
  const dynamicDir = overrides.dynamicDir ?? '/tmp/portta-test-dynamic'
  return loadConfig({
    dockerApi: 'http://socket-proxy:2375',
    envFile: '/dev/null',
    versionFile: '/dev/null',
    profile: 'local',
    domain: 'localhost',
    network: 'portta',
    controlNetwork: 'portta-control',
    accessNetwork: 'portta-access',
    gatewayVersion: '0.2.0',
    panelVersion: '0.1.0',
    tlsEnabled: false,
    readOnly: false,
    docs: true,
    docsDir: './dist/docs',
    privateDomain: null,
    publicDomain: null,
    dynamicDir,
    authStore: overrides.authStore ?? join(dynamicDir, 'protections.json'),
    runnerDir: overrides.runnerDir ?? join(dynamicDir, 'runner'),
    accessDir: overrides.accessDir ?? join(dynamicDir, 'access'),
    ...overrides,
  })
}

/**
 * A real SQLite, in memory, migrated, and seeded with the situation nearly
 * every suite needs: one Project with one Repository on a GitHub remote, and
 * the two environments it has been seen running.
 *
 * The real engine rather than hand-written stand-ins, one per repository: those
 * are cheap and wrong in the way stand-ins always are — they accept rows a
 * check would refuse, return ids in a shape the driver never produces, and let
 * a query the panel got wrong pass anyway. The real engine costs single-digit
 * milliseconds and answers with the database.
 */
export interface SeededDatabase {
  database: Database
  db: Db
  /** The ids the seed produced, as the API returns them: strings. */
  ids: {
    project: string
    repository: string
    environment: string
  }
  close: () => Promise<void>
}

export interface SeedOptions {
  /** Skip the fixture rows and start from an empty schema. */
  empty?: boolean
  /**
   * Report the connection as down, so `requireDatabase` refuses. This is the
   * state a dropped connection leaves behind — not "no database configured",
   * which is not a state the panel can be in: the database is a boot dependency.
   */
  available?: boolean
}

export async function seededDatabase(options: SeedOptions = {}): Promise<SeededDatabase> {
  const { db, close } = await createTestDb()
  return seed(db, close, options)
}

/**
 * One database for every test in a file, for the files that ask for one in
 * nearly every test.
 *
 * Call it at module scope. Each call of the seeder it returns empties the
 * database and seeds it again, so a test starts from the same rows it would
 * with `seededDatabase` — and only one test's rows exist at a time, which is
 * why a test must not hold two. The instance is closed after the file.
 */
export function databasePerFile(): (options?: SeedOptions) => Promise<SeededDatabase> {
  let shared: ReturnType<typeof createTestDb> | undefined
  afterAll(async () => {
    await (await shared)?.close()
    shared = undefined
  })
  return async (options = {}) => {
    shared ??= createTestDb()
    const { db } = await shared
    await resetTestDb(db)
    return seed(db, async () => undefined, options)
  }
}

async function seed(db: TestDb, close: () => Promise<void>, options: SeedOptions): Promise<SeededDatabase> {
  const database =
    options.available === false
      ? new Database(db as unknown as Db, unreachableBackend())
      : Database.forTesting(db as unknown as Db)
  if (options.available !== false) await database.initialize()
  const ids = { project: '', repository: '', environment: '' }

  if (options.empty !== true) {
    const [project] = await db
      .insert(projectsTable)
      .values({ slug: 'produto', name: 'Produto' })
      .returning({ id: projectsTable.id })
    // A GitHub remote and nothing else: the coordinate an issue read needs is
    // derived from it, exactly as it is for a Project an operator registered.
    const [repository] = await db
      .insert(repositoriesTable)
      .values({
        projectId: project!.id,
        name: 'api',
        provider: 'github',
        remoteUrl: 'https://github.com/acme/api',
      })
      .returning({ id: repositoriesTable.id })
    const seen = await db
      .insert(environmentsTable)
      .values([{ composeProject: 'alpha' }, { composeProject: 'alpha-issue182' }])
      .returning({ id: environmentsTable.id, composeProject: environmentsTable.composeProject })

    ids.project = String(project!.id)
    ids.repository = String(repository!.id)
    ids.environment = String(seen.find((row) => row.composeProject === 'alpha')!.id)
  }

  return { database, db: db as unknown as Db, ids, close }
}

/**
 * A database the panel cannot reach.
 *
 * Most suites here are about Docker, Traefik or the gateway and never touch
 * persistence. Passing this says so, and keeps a route that *does* touch it
 * answering 503 — which is the boundary those suites were asserting when the
 * dependency was optional and they passed `null`.
 */
export function detachedDatabase(): Database {
  return new Database(undefined as never, unreachableBackend())
}

/** A backend whose server is not there: every call to it fails the way one would. */
function unreachableBackend() {
  const refuse = async (): Promise<never> => {
    throw new Error('no database connection in this test')
  }
  return { migrate: refuse, applied: refuse, ping: refuse, close: async () => undefined }
}

/** What a `ForgeClient` answered, and what was asked to get it. */
export interface FakeForge {
  client: ForgeClient
  calls: ForgeRequest[]
}

export type ForgeHandler = (request: ForgeRequest) => unknown

const NO_DAEMON = 'no host daemon in this test'

/**
 * A host daemon that answers, in the shape `gh` and Linear answer in.
 *
 * The default is a host with nothing signed in: every suite here builds an app,
 * and almost none of them are about issues — so the dashboard reads "no
 * provider" rather than a list, which is the situation a panel on a fresh host
 * is actually in. A suite about issues passes its own handler, and throws
 * `ForgeUnavailable` from it to state a provider failure.
 */
export function fakeForge(handler: ForgeHandler = silentDaemon): FakeForge {
  const calls: ForgeRequest[] = []
  return {
    calls,
    client: {
      async call<T>(request: ForgeRequest): Promise<T> {
        calls.push(request)
        return handler(request) as T
      },
    },
  }
}

function silentDaemon(request: ForgeRequest): unknown {
  // The daemon's own vocabulary: `detail`, which `forgeStatus` renames to the
  // contract's `reason`. A fake answers what the daemon answers.
  const down = { available: false, authenticated: false, account: null, detail: NO_DAEMON }
  if (request.path === '/status') return { github: down, linear: { ...down } }
  throw new ForgeUnavailable('daemon-unreachable', NO_DAEMON)
}

export function makeApp(
  options: FakeDockerOptions = {},
  configOverrides: Partial<PanelConfig> = {},
  db: Database = detachedDatabase(),
  forge: ForgeClient = fakeForge().client,
) {
  const docker = fakeDocker(options)
  const config = testConfig(configOverrides)
  const cache = createSnapshotCache(docker.client, config, 0)
  const hub = new LiveHub(docker.client, cache)
  const verdict = createVerdictCache(config, 0)
  // Open mode, which is what every route suite is about: who the caller is has
  // its own suites in `packages/auth`, and repeating a sign-in here would test
  // the harness rather than the route.
  const security = resolveSecurityMode(config.readOnly ? { PORTTA_RUNTIME_READ_ONLY: 'true' } : {})
  const principals = createPrincipalResolver({ security, db: db.handle, auth: null })
  const app: Hono = createApp({
    config,
    client: docker.client,
    cache,
    hub,
    verdict,
    db,
    forge,
    security,
    auth: null,
    principals,
  })
  return { app, docker, config, cache, hub, verdict, db, forge, security, principals }
}

/** Same-origin by default: the API refuses cross-origin writes. */
export async function post(
  app: Hono,
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
  })
}

export async function del(app: Hono, path: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

const digest = (password: string) => `sha256:${createHash('sha256').update(password).digest('hex')}`

/**
 * SHA-256 instead of scrypt. Scrypt is slow on purpose, and what it protects is
 * proved in `packages/auth`; here it would only make every sign-in wait.
 */
export const cheapPasswords = {
  hash: async (password: string) => digest(password),
  verify: async ({ hash, password }: { hash: string; password: string }) => hash === digest(password),
}

/**
 * The panel with `PORTTA_AUTH_MODE=required`: a real Better Auth over the test
 * database, and a way to sign somebody in.
 *
 * The route suites use `makeApp`, which is open mode, because who the caller is
 * has its own suites. This is for the ones that are about exactly that.
 */
export function makeProtectedApp(
  database: Database,
  configOverrides: Partial<PanelConfig> = {},
  dockerOptions: FakeDockerOptions = {},
) {
  const docker = fakeDocker(dockerOptions)
  const config = testConfig(configOverrides)
  const cache = createSnapshotCache(docker.client, config, 0)
  const hub = new LiveHub(docker.client, cache)
  const verdict = createVerdictCache(config, 0)
  const security = resolveSecurityMode({
    PORTTA_AUTH_MODE: 'required',
    PORTTA_AUTH_SECRET: 'a-test-secret-that-is-long-enough',
    ...(config.readOnly ? { PORTTA_RUNTIME_READ_ONLY: 'true' } : {}),
  })
  const handle = database.handle
  const auth = createAuth({ db: handle, security, hasOwner: () => hasOwner(handle), password: cheapPasswords })
  const principals = createPrincipalResolver({ security, db: handle, auth })
  const app: Hono = createApp({
    config,
    client: docker.client,
    cache,
    hub,
    verdict,
    db: database,
    forge: fakeForge().client,
    security,
    auth,
    principals,
  })
  return { app, auth, config, security, principals, db: handle }
}

/** Sign in, and hand back the cookie a browser would send next time. */
export async function signInAs(
  auth: ReturnType<typeof makeProtectedApp>['auth'],
  email: string,
  password: string,
): Promise<Record<string, string>> {
  const response = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  const cookie = response.headers.get('set-cookie')
  return cookie ? { cookie: cookie.split(';')[0] ?? '' } : {}
}
