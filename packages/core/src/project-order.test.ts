import { describe, expect, it } from 'vitest'
import { orderProjectServices, parseDependsOn } from './project-order.ts'

describe('parseDependsOn', () => {
  it('reads the Compose label form', () => {
    expect(parseDependsOn('db:service_started:false,redis:service_healthy:false')).toEqual(['db', 'redis'])
  })

  it('reads a JSON map and an empty label', () => {
    expect(parseDependsOn('{"db":{"condition":"service_started"}}')).toEqual(['db'])
    expect(parseDependsOn('')).toEqual([])
    expect(parseDependsOn(undefined)).toEqual([])
  })
})

describe('orderProjectServices', () => {
  const api = { service: 'api', name: 'alpha-api-1', dependsOn: ['db'] }
  const db = { service: 'db', name: 'alpha-db-1', dependsOn: [] }
  const web = { service: 'web', name: 'alpha-web-1', dependsOn: ['api'] }
  const worker = { service: 'worker', name: 'alpha-worker-1', dependsOn: [] }

  it('stops dependents before dependencies', () => {
    expect(orderProjectServices([api, db, web], 'stop').map((entry) => entry.service)).toEqual(['web', 'api', 'db'])
  })

  it('starts dependencies before dependents', () => {
    expect(orderProjectServices([api, db, web], 'start').map((entry) => entry.service)).toEqual(['db', 'api', 'web'])
  })

  it('falls back to the service name when nothing is declared', () => {
    expect(orderProjectServices([worker, api, db], 'stop').map((entry) => entry.service)).toEqual([
      'api',
      'db',
      'worker',
    ])
  })
})
