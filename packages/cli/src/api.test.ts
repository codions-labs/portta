import { describe, expect, it } from 'vitest'
import { panelHeaders, panelRequestHeaders } from './api.ts'

// Who the panel thinks is at the other end.
//
// The resolver narrows a request that announces itself as an agent to what
// agents hold, and it reads an actor with no declared kind as one. That is the
// right default for a bare header on the API and the wrong one for a terminal:
// `portta projects create` is a person, and being read as an agent made it
// answer 403 for `project:create` on a panel where the operator holds
// everything.
describe('the kind of actor a command declares', () => {
  const context = (env: Record<string, string> = {}) =>
    ({ env: { PORTTA_WEB_PORT: '8081', ...env } }) as unknown as Parameters<typeof panelRequestHeaders>[0]

  it('is a person, because somebody is typing', () => {
    expect(panelRequestHeaders(context())['X-Portta-Actor-Kind']).toBe('human')
  })

  it('unless an agent driving the CLI says so', () => {
    expect(panelRequestHeaders(context({ PORTTA_ACTOR_KIND: 'agent' }))['X-Portta-Actor-Kind']).toBe('agent')
  })

  it('and a caller that names the kind outright wins over both', () => {
    expect(
      panelRequestHeaders(context({ PORTTA_ACTOR_KIND: 'agent' }), { actorKind: 'human' })['X-Portta-Actor-Kind'],
    ).toBe('human')
  })

  // `portta mcp` is the surface agents drive, so it says agent outright rather
  // than leaning on a default that is now the other way round.
  it('while portta mcp declares agent, whatever the environment says', () => {
    expect(panelHeaders({ PORTTA_ACTOR_KIND: 'human' }, 'claude', 'agent')['X-Portta-Actor-Kind']).toBe('agent')
  })
})
