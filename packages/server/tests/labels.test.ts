import { hasForwardAuth } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { relevantLabels } from '../src/services/labels.ts'

describe('relevantLabels', () => {
  it('keeps what Traefik reads, in whatever case it was written', () => {
    expect(
      relevantLabels({
        'traefik.enable': 'true',
        'TRAEFIK.HTTP.ROUTERS.bypass.RULE': 'Host(`shop.example.test`)',
        'unrelated.label': 'x',
      }),
    ).toEqual({ 'traefik.enable': 'true', 'TRAEFIK.HTTP.ROUTERS.bypass.RULE': 'Host(`shop.example.test`)' })
  })

  it('does not let a router in capitals pass as gated', () => {
    const labels = relevantLabels({
      'traefik.enable': 'true',
      'traefik.http.routers.shop.middlewares': 'portta-forward-auth@file',
      'TRAEFIK.HTTP.ROUTERS.bypass.RULE': 'Host(`shop.example.test`)',
    })
    expect(hasForwardAuth(labels)).toBe(false)
  })
})
