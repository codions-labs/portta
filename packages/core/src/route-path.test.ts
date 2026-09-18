import { describe, expect, it } from 'vitest'
import { matchPath } from './route-path.ts'

describe('a route pattern', () => {
  it('binds the rest of the path to a trailing wildcard, and only there', () => {
    expect(matchPath('/runs/:id/*', '/runs/7/events/stream')).toEqual({ id: '7', '*': 'events/stream' })
    expect(matchPath('/runs/:id/*', '/runs/7')).toEqual({ id: '7', '*': '' })
    expect(matchPath('/runs/:id/*', '/runs')).toBeNull()
    expect(matchPath('/runs/:id/*', '/other/7/events')).toBeNull()
  })
})
