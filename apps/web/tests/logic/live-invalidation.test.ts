import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateFor, keysFor } from '@/lib/live'

const event = (kind: string, extra: Partial<{ action: string; name: string | null; project: string | null }> = {}) => ({
  kind: kind as never,
  action: 'start',
  name: null,
  project: null,
  ...extra,
})

describe('what a live event makes stale', () => {
  it('a container event touches the runtime, not the settings', () => {
    const keys = keysFor(event('container', { project: 'alpha' })).map((key) => key.join('/'))
    expect(keys).toContain('environments')
    expect(keys).toContain('environments/alpha')
    expect(keys).toContain('services')
    expect(keys).toContain('docker')
    expect(keys).not.toContain('config')
    expect(keys).not.toContain('github')
  })

  it('an issue change touches the work, not the containers', () => {
    const keys = keysFor(event('config', { action: 'issue' })).map((key) => key.join('/'))
    expect(keys).toContain('projects')
    expect(keys).toContain('issues')
    expect(keys).not.toContain('docker')
  })

  it('a settings change touches config and the gateway', () => {
    const keys = keysFor(event('config', { action: 'env' })).map((key) => key.join('/'))
    expect(keys).toEqual(expect.arrayContaining(['config', 'gateway', 'status']))
  })

  it('a kind this build does not know falls into the project set', () => {
    const keys = keysFor(event('session', { project: 'alpha' })).map((key) => key.join('/'))
    expect(keys).toContain('projects')
    expect(keys).toContain('environments/alpha')
  })

  it('hello invalidates everything', () => {
    expect(keysFor(event('hello'))).toEqual([[]])
  })

  it('invalidates by prefix so a nested key is reached', async () => {
    const client = new QueryClient()
    client.setQueryData(['environments', 'alpha', 'git'], { collected: true })
    client.setQueryData(['config'], { groups: [] })
    invalidateFor(client, event('container', { project: 'alpha' }))
    expect(client.getQueryState(['environments', 'alpha', 'git'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['config'])?.isInvalidated).toBe(false)
  })
})
