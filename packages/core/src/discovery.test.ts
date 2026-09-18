import { describe, expect, it } from 'vitest'
import {
  connectionString,
  defaultPortForImage,
  gatewayConnectionString,
  isHostnameRoutable,
  serviceKind,
  tcpEntrypoint,
  tcpRouting,
} from './discovery.ts'

describe('serviceKind', () => {
  it('reads the family from the image reference, not the tag', () => {
    expect(serviceKind('postgres:18.6-alpine')).toBe('postgres')
    expect(serviceKind('postgis/postgis:16-3.4')).toBe('postgres')
  })

  it('is case-insensitive, because a registry path need not be lower-cased', () => {
    expect(serviceKind('ghcr.io/Acme/PostgreSQL:16')).toBe('postgres')
  })

  it('falls back to tcp rather than guessing', () => {
    expect(serviceKind('nginx:1.27')).toBe('tcp')
    expect(serviceKind('')).toBe('tcp')
  })

  // Cassandra and Neo4j are reached as plain TCP, so they carry no kind of
  // their own — but the shell knew their ports and neither TypeScript copy
  // did, which is how `access open` came to guess nothing for them.
  it('classifies Cassandra and Neo4j as tcp while still knowing their ports', () => {
    expect(serviceKind('cassandra:5')).toBe('tcp')
    expect(defaultPortForImage('cassandra:5')).toBe(9042)
    expect(serviceKind('neo4j:5')).toBe('tcp')
    expect(defaultPortForImage('neo4j:5')).toBe(7687)
  })
})

describe('defaultPortForImage', () => {
  it('answers null when it does not know, so the caller asks instead of guessing', () => {
    expect(defaultPortForImage('nginx:1.27')).toBeNull()
  })
})

describe('tcp routing', () => {
  it('carries only verdicts that were measured with two live instances', () => {
    expect(tcpRouting('postgres')).toBe('starttls-sni')
    expect(tcpRouting('redis')).toBe('tls-sni')
    expect(tcpRouting('mysql')).toBe('unsupported')
  })

  it('treats anything untested as unevaluated, never as routable', () => {
    expect(tcpRouting('mongodb')).toBe('unevaluated')
    expect(tcpRouting('clickhouse')).toBe('unevaluated')
    expect(isHostnameRoutable('mongodb')).toBe(false)
  })

  it('offers an entrypoint exactly where it is routable', () => {
    expect(isHostnameRoutable('postgres')).toBe(true)
    expect(tcpEntrypoint('postgres')).toBe('postgres')
    expect(isHostnameRoutable('redis')).toBe(true)
    expect(tcpEntrypoint('redis')).toBe('redis')

    expect(tcpEntrypoint('mysql')).toBeNull()
  })
})

describe('connection strings', () => {
  it('never contains a credential, only a placeholder', () => {
    for (const kind of ['postgres', 'mysql', 'mongodb', 'clickhouse', 'amqp'] as const) {
      expect(connectionString(kind, 'host', 1)).toContain('<user>')
    }
    expect(connectionString('redis', '127.0.0.1', 6379)).toBe('redis://127.0.0.1:6379')
    expect(connectionString('tcp', '127.0.0.1', 9999)).toBe('127.0.0.1:9999')
  })

  it('fills in discovered credentials without changing the template callers', () => {
    expect(
      connectionString('postgres', 'db.localhost', 5432, {
        user: 'shop',
        password: 'p@ss',
        database: 'store',
      }),
    ).toBe('postgresql://shop:p%40ss@db.localhost:5432/store')
    expect(connectionString('redis', 'cache.localhost', 6379, { password: 'r' })).toBe(
      'redis://:r@cache.localhost:6379',
    )
  })

  // redis-cli does not derive SNI from -h, so the flag is the whole point.
  it('tells a gateway client which instance it wants', () => {
    expect(gatewayConnectionString('postgres', 'a-db.example.com', 5432)).toContain('sslmode=require')
    expect(gatewayConnectionString('redis', 'a-redis.example.com', 6379)).toContain('--sni a-redis.example.com')
    expect(gatewayConnectionString('tcp', 'host', 1)).toBe('host:1')
  })
})
