// What a service *is*, and how a client is supposed to reach it.
//
// This is the one table. Everything here is a pure derivation from an image
// reference or a kind. The
// probes that supply those inputs run Docker, and live in packages/cli.

/**
 * Every way Portta can classify a service. `tcp` is the honest fallback for a
 * container that exposes a port and matches no rule. `worker` is a container
 * with no port at all (a queue consumer, a scheduler, a loop): never returned
 * by `serviceKind`, which only sees the image, and assigned by whoever also
 * sees the ports.
 */
export const SERVICE_KINDS = [
  'http',
  'postgres',
  'mysql',
  'redis',
  'mongodb',
  'memcached',
  'search',
  'amqp',
  'clickhouse',
  'smtp',
  'tcp',
  'worker',
] as const
export type ServiceKind = (typeof SERVICE_KINDS)[number]

/**
 * Whether a protocol can be told apart by hostname on a shared port, and how.
 * Every entry was verified with two live instances and a real client; see
 * docs/product/guides/tcp-routing.md. Nothing is listed as routable because a neighbouring
 * protocol behaves that way.
 *
 *   starttls-sni  client opens in plaintext, asks to upgrade, then sends SNI
 *   tls-sni       client sends a TLS ClientHello first, so SNI is there at once
 *   unsupported   the server speaks first, so there is no SNI to route on
 *   unevaluated   not tested, and therefore not offered
 */
export const TCP_ROUTINGS = ['starttls-sni', 'tls-sni', 'unsupported', 'unevaluated'] as const
export type TcpRouting = (typeof TCP_ROUTINGS)[number]

/** Pinned; see docs/development/adr/0004-pinned-versions.md. */
export const BRIDGE_IMAGE = 'alpine/socat:1.8.1.3'

/**
 * Matched against a lower-cased image reference, in order. A rule may carry a
 * port without carrying a kind of its own: Cassandra and Neo4j are reached as
 * plain TCP, but their well-known port is still the right guess.
 */
const KIND_RULES: { match: RegExp; kind: ServiceKind; port: number }[] = [
  { match: /postgres|postgis|timescale/, kind: 'postgres', port: 5432 },
  { match: /mysql|mariadb|percona/, kind: 'mysql', port: 3306 },
  { match: /redis|valkey|keydb/, kind: 'redis', port: 6379 },
  { match: /mongo/, kind: 'mongodb', port: 27017 },
  { match: /memcached/, kind: 'memcached', port: 11211 },
  { match: /elasticsearch|opensearch/, kind: 'search', port: 9200 },
  { match: /rabbitmq/, kind: 'amqp', port: 5672 },
  { match: /clickhouse/, kind: 'clickhouse', port: 9000 },
  { match: /cassandra/, kind: 'tcp', port: 9042 },
  { match: /neo4j/, kind: 'tcp', port: 7687 },
  { match: /mailpit|mailhog/, kind: 'smtp', port: 1025 },
]

function rule(image: string) {
  const lower = (image ?? '').toLowerCase()
  return KIND_RULES.find((candidate) => candidate.match.test(lower))
}

/** How a service should be reached, from its image reference alone. */
export function serviceKind(image: string): ServiceKind {
  return rule(image)?.kind ?? 'tcp'
}

/**
 * The well-known port, used only when a container exposes several and we have
 * to guess. An explicit `--port` always wins.
 */
export function defaultPortForImage(image: string): number | null {
  return rule(image)?.port ?? null
}

const TCP_ROUTING: Partial<Record<ServiceKind, TcpRouting>> = {
  postgres: 'starttls-sni',
  redis: 'tls-sni',
  mysql: 'unsupported',
}

export function tcpRouting(kind: ServiceKind): TcpRouting {
  return TCP_ROUTING[kind] ?? 'unevaluated'
}

export function isHostnameRoutable(kind: ServiceKind): boolean {
  const routing = tcpRouting(kind)
  return routing === 'starttls-sni' || routing === 'tls-sni'
}

/** The Traefik entrypoint that serves a kind, or null when it cannot be routed. */
export function tcpEntrypoint(kind: ServiceKind): string | null {
  switch (kind) {
    case 'postgres':
      return 'postgres'
    case 'redis':
      return 'redis'
    default:
      return null
  }
}

/**
 * How a client is told which instance it wants, when it connects through the
 * gateway's shared TCP entrypoint. PostgreSQL puts it in the connection
 * string; redis-cli needs an explicit flag, because it does not derive SNI
 * from `-h`.
 */
export function gatewayConnectionString(
  kind: ServiceKind,
  host: string,
  port: number,
  credentials?: ConnectionCredentials,
): string {
  switch (kind) {
    case 'postgres':
      return `${connectionString(kind, host, port, credentials)}?sslmode=require`
    case 'redis': {
      const password = credentials?.password
      return password
        ? `redis-cli -h 127.0.0.1 -p ${port} --tls --sni ${host} -a ${password}`
        : `redis-cli -h 127.0.0.1 -p ${port} --tls --sni ${host}`
    }
    default:
      return `${host}:${port}`
  }
}

export interface ConnectionCredentials {
  user?: string | null
  password?: string | null
  database?: string | null
}

function authPrefix(credentials?: ConnectionCredentials): string {
  if (!credentials) return ''
  const user = credentials.user ?? ''
  const password = credentials.password
  if (user && password) return `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
  if (user) return `${encodeURIComponent(user)}@`
  if (password) return `:${encodeURIComponent(password)}@`
  return ''
}

function databasePath(credentials: ConnectionCredentials | undefined, fallback: string): string {
  if (!credentials) return fallback
  return credentials.database ? encodeURIComponent(credentials.database) : fallback
}

/**
 * A connection string. Without credentials it stays a template — existing
 * callers are unaffected. With them it is complete enough to paste.
 */
export function connectionString(
  kind: ServiceKind,
  host: string,
  port: number,
  credentials?: ConnectionCredentials,
): string {
  const auth = authPrefix(credentials)
  switch (kind) {
    case 'postgres':
      return `postgresql://${auth || '<user>@'}${host}:${port}/${databasePath(credentials, '<database>')}`
    case 'mysql':
      return `mysql://${auth || '<user>@'}${host}:${port}/${databasePath(credentials, '<database>')}`
    case 'redis':
      return auth ? `redis://${auth}${host}:${port}` : `redis://${host}:${port}`
    case 'mongodb':
      return `mongodb://${auth || '<user>@'}${host}:${port}/${databasePath(credentials, '<database>')}`
    case 'clickhouse':
      return `clickhouse://${auth || '<user>@'}${host}:${port}/${databasePath(credentials, '<database>')}`
    case 'amqp':
      return `amqp://${auth || '<user>@'}${host}:${port}/`
    default:
      return `${host}:${port}`
  }
}
