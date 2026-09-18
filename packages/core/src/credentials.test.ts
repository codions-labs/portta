import { describe, expect, it } from 'vitest'
import { credentialsFromEnv, parseContainerEnv } from './credentials.js'
import { connectionString } from './discovery.js'
import { redactSecrets } from './redact.js'

describe('parseContainerEnv', () => {
  it('splits KEY=value and keeps extra equals in the value', () => {
    expect(parseContainerEnv(['POSTGRES_PASSWORD=a=b=c', 'EMPTY=', 'NOVALUE'])).toEqual({
      POSTGRES_PASSWORD: 'a=b=c',
      EMPTY: '',
    })
  })
})

describe('credentialsFromEnv', () => {
  it('reads a conventional Postgres image', () => {
    const result = credentialsFromEnv('postgres', {
      POSTGRES_USER: 'shop',
      POSTGRES_PASSWORD: 's3cret',
      POSTGRES_DB: 'storefront',
    })
    expect(result.reason).toBeNull()
    expect(result.credentials).toEqual({
      user: 'shop',
      password: 's3cret',
      database: 'storefront',
      source: 'POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB',
    })
  })

  it('defaults the Postgres user and database, and refuses a missing password', () => {
    expect(credentialsFromEnv('postgres', { POSTGRES_PASSWORD: 'x' }).credentials).toMatchObject({
      user: 'postgres',
      database: 'postgres',
    })
    expect(credentialsFromEnv('postgres', {}).reason).toMatch(/POSTGRES_PASSWORD/)
  })

  it('prefers a MySQL user over root, and falls back to the root password', () => {
    const user = credentialsFromEnv('mysql', {
      MYSQL_USER: 'app',
      MYSQL_PASSWORD: 'pw',
      MYSQL_DATABASE: 'app',
    })
    expect(user.credentials).toMatchObject({ user: 'app', password: 'pw', database: 'app' })
    const root = credentialsFromEnv('mysql', { MYSQL_ROOT_PASSWORD: 'rootpw' })
    expect(root.credentials).toMatchObject({ user: 'root', password: 'rootpw' })
    expect(credentialsFromEnv('mysql', {}).reason).toMatch(/MYSQL_PASSWORD or MYSQL_ROOT_PASSWORD/)
  })

  it('reads Redis, MongoDB, ClickHouse and RabbitMQ conventions', () => {
    expect(credentialsFromEnv('redis', { REDIS_PASSWORD: 'r' }).credentials).toMatchObject({
      user: null,
      password: 'r',
      database: null,
    })
    expect(
      credentialsFromEnv('mongodb', {
        MONGO_INITDB_ROOT_USERNAME: 'root',
        MONGO_INITDB_ROOT_PASSWORD: 'm',
        MONGO_INITDB_DATABASE: 'app',
      }).credentials,
    ).toMatchObject({ user: 'root', password: 'm', database: 'app' })
    expect(credentialsFromEnv('clickhouse', { CLICKHOUSE_PASSWORD: 'c' }).credentials).toMatchObject({
      user: 'default',
      password: 'c',
    })
    expect(
      credentialsFromEnv('amqp', {
        RABBITMQ_DEFAULT_USER: 'guest',
        RABBITMQ_DEFAULT_PASS: 'guest',
      }).credentials,
    ).toMatchObject({ user: 'guest', password: 'guest' })
  })

  it('says so when the kind has no conventional variables', () => {
    expect(credentialsFromEnv('memcached', {}).reason).toMatch(/not discoverable/)
    expect(credentialsFromEnv('tcp', { POSTGRES_PASSWORD: 'x' }).credentials).toBeNull()
  })
})

describe('a discovered password does not survive the logger', () => {
  it('redacts every secret out of a connection string', () => {
    const result = credentialsFromEnv('postgres', {
      POSTGRES_USER: 'shop',
      POSTGRES_PASSWORD: 's3cret-value',
      POSTGRES_DB: 'storefront',
    })
    const line = connectionString('postgres', 'db.localhost', 5432, result.credentials ?? undefined)
    expect(line).toContain('s3cret-value')
    const secrets = result.credentials?.password ? [result.credentials.password] : []
    expect(redactSecrets(line, secrets)).not.toContain('s3cret-value')
    expect(redactSecrets(line, secrets)).toContain('***')
  })
})
