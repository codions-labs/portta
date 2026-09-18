// How a conventional image carries its credentials, and what to say when it
// does not. The values come from the container's environment — the resolved
// truth — never from a Compose file the panel would have to invent a path to.
//
// A missing password is reported as not discoverable, with the reason. That
// is the correct answer and it is better than a plausible wrong one.

import type { ServiceKind } from './discovery.ts'

export interface ServiceCredentials {
  user: string | null
  password: string | null
  database: string | null
  /** Which variables produced this result, so the panel can say so. */
  source: string
}

export interface CredentialsResult {
  credentials: ServiceCredentials | null
  reason: string | null
}

/** Split Docker's `KEY=value` list. A value may itself contain `=`. */
export function parseContainerEnv(entries: string[] | null | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entry of entries ?? []) {
    const cut = entry.indexOf('=')
    if (cut <= 0) continue
    env[entry.slice(0, cut)] = entry.slice(cut + 1)
  }
  return env
}

function found(
  user: string | null,
  password: string | null,
  database: string | null,
  source: string,
): CredentialsResult {
  return { credentials: { user, password, database, source }, reason: null }
}

function missing(reason: string): CredentialsResult {
  return { credentials: null, reason }
}

/**
 * Map a service kind onto the environment variables that conventionally
 * carry its credentials. Unrecognised kinds, and images that put the
 * password on the command line or in a secret file, come back with a reason.
 */
export function credentialsFromEnv(kind: ServiceKind, env: Record<string, string>): CredentialsResult {
  switch (kind) {
    case 'postgres': {
      const password = env.POSTGRES_PASSWORD
      if (!password) return missing('POSTGRES_PASSWORD is not in the container environment')
      return found(
        env.POSTGRES_USER || 'postgres',
        password,
        env.POSTGRES_DB || 'postgres',
        'POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB',
      )
    }
    case 'mysql': {
      if (env.MYSQL_USER && env.MYSQL_PASSWORD) {
        return found(
          env.MYSQL_USER,
          env.MYSQL_PASSWORD,
          env.MYSQL_DATABASE ?? null,
          'MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE',
        )
      }
      if (env.MYSQL_ROOT_PASSWORD) {
        return found('root', env.MYSQL_ROOT_PASSWORD, env.MYSQL_DATABASE ?? null, 'MYSQL_ROOT_PASSWORD, MYSQL_DATABASE')
      }
      return missing('MYSQL_PASSWORD or MYSQL_ROOT_PASSWORD is not in the container environment')
    }
    case 'redis': {
      const password = env.REDIS_PASSWORD
      if (!password) return missing('REDIS_PASSWORD is not in the container environment')
      return found(null, password, null, 'REDIS_PASSWORD')
    }
    case 'mongodb': {
      const user = env.MONGO_INITDB_ROOT_USERNAME
      const password = env.MONGO_INITDB_ROOT_PASSWORD
      if (!user || !password) {
        return missing('MONGO_INITDB_ROOT_USERNAME or MONGO_INITDB_ROOT_PASSWORD is not in the container environment')
      }
      return found(
        user,
        password,
        env.MONGO_INITDB_DATABASE ?? null,
        'MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD, MONGO_INITDB_DATABASE',
      )
    }
    case 'clickhouse': {
      const password = env.CLICKHOUSE_PASSWORD
      if (!password) return missing('CLICKHOUSE_PASSWORD is not in the container environment')
      return found(
        env.CLICKHOUSE_USER || 'default',
        password,
        env.CLICKHOUSE_DB ?? null,
        'CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DB',
      )
    }
    case 'amqp': {
      const user = env.RABBITMQ_DEFAULT_USER
      const password = env.RABBITMQ_DEFAULT_PASS
      if (!user || !password) {
        return missing('RABBITMQ_DEFAULT_USER or RABBITMQ_DEFAULT_PASS is not in the container environment')
      }
      return found(user, password, null, 'RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS')
    }
    default:
      return missing(`${kind} credentials are not discoverable from the container environment`)
  }
}
