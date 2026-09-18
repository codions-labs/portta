// What a stream is allowed to deliver.
//
// The filter is the same `sees` every listing uses, applied per event rather
// than per request — and the two cases that are easy to get wrong are the ones
// with no Project in them at all: a settings change, and an environment nobody
// adopted. Neither belongs to anybody, which means neither is for anybody but
// the people who see everything.

import { principalFor } from 'portta-auth-core'
import type { LiveEvent } from 'portta-contracts'
import { projectEnvironments } from 'portta-db'
import { beforeAll, describe, expect, it } from 'vitest'
import { eventVisibility } from '../../src/services/access-control.ts'
import { type SeededDatabase, seededDatabase } from '../helpers.ts'

let seeded: SeededDatabase

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    kind: 'environment',
    action: 'started',
    id: null,
    name: 'produto',
    project: 'produto',
    ownership: 'integrated',
    at: 0,
    ...overrides,
  } as LiveEvent
}

beforeAll(async () => {
  seeded = await seededDatabase()
  // The seed leaves `alpha` running and unadopted, which is one of the cases
  // below. This adopts it, so the other case — an environment that belongs to
  // a Project — has something to be about.
  await seeded.db.insert(projectEnvironments).values({
    projectId: Number(seeded.ids.project),
    environmentId: Number(seeded.ids.environment),
    source: 'manual',
  })
})

describe('somebody who sees everything', () => {
  it('receives every event, including the ones about no Project', async () => {
    const visibility = eventVisibility(seeded.database, principalFor())
    await visibility.refresh()
    expect(visibility.allows(event())).toBe(true)
    expect(visibility.allows(event({ kind: 'config', project: null }))).toBe(true)
    expect(visibility.allows(event({ project: 'nothing-adopted-this' }))).toBe(true)
  })
})

describe('somebody with a membership', () => {
  it('receives the Projects they are in, by slug', async () => {
    const member = principalFor({ kind: 'user', scope: new Set([Number(seeded.ids.project)]) })
    const visibility = eventVisibility(seeded.database, member)
    await visibility.refresh()
    expect(visibility.allows(event({ project: 'produto' }))).toBe(true)
  })

  it('and the environments those Projects adopted', async () => {
    const member = principalFor({ kind: 'user', scope: new Set([Number(seeded.ids.project)]) })
    const visibility = eventVisibility(seeded.database, member)
    await visibility.refresh()
    // The hub names an environment event by its Compose project, which is what
    // the adoption row points at.
    expect(visibility.allows(event({ project: 'alpha' }))).toBe(true)
  })

  it('never an event about a Project they are not in', async () => {
    const outsider = principalFor({ kind: 'user', scope: new Set([999_999]) })
    const visibility = eventVisibility(seeded.database, outsider)
    await visibility.refresh()
    expect(visibility.allows(event({ project: 'produto' }))).toBe(false)
    expect(visibility.allows(event({ project: 'alpha' }))).toBe(false)
  })

  // A settings change, a gateway restart, a GitHub sync: nothing in them
  // belongs to a Project, so nothing in them is scoped by one.
  it('and never an event with no Project in it at all', async () => {
    const member = principalFor({ kind: 'user', scope: new Set([Number(seeded.ids.project)]) })
    const visibility = eventVisibility(seeded.database, member)
    await visibility.refresh()
    expect(visibility.allows(event({ kind: 'config', project: null }))).toBe(false)
    expect(visibility.allows(event({ kind: 'network', project: null }))).toBe(false)
    expect(visibility.allows(event({ kind: 'health', project: null }))).toBe(false)
  })

  it('and never an environment nobody adopted', async () => {
    const member = principalFor({ kind: 'user', scope: new Set([Number(seeded.ids.project)]) })
    const visibility = eventVisibility(seeded.database, member)
    await visibility.refresh()
    // `alpha-issue182` is running and belongs to no Project. It is for the
    // people who see everything, and for nobody else.
    expect(visibility.allows(event({ project: 'alpha-issue182' }))).toBe(false)
    expect(visibility.allows(event({ project: 'orphan' }))).toBe(false)
  })
})
