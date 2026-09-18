import { describe, expect, it } from 'vitest'
import { ProjectInitTracker } from '../services/project-init-service.ts'

describe('ProjectInitTracker', () => {
  it('upserts phase transitions and carries prefix/name into ready', () => {
    const tracker = new ProjectInitTracker()
    tracker.set('/repo/a', { phase: 'creating_config' })
    expect(tracker.isActive('/repo/a')).toBe(true)

    tracker.set('/repo/a', { phase: 'analyzing' })
    tracker.set('/repo/a', { phase: 'ready', prefix: 'a', name: 'A' })

    const state = tracker.get('/repo/a')
    expect(state).toMatchObject({ phase: 'ready', prefix: 'a', name: 'A', error: null })
    expect(tracker.isActive('/repo/a')).toBe(false)
  })

  it('evicts terminal entries past the TTL but keeps in-flight ones', () => {
    let clock = 1000
    const tracker = new ProjectInitTracker({ ttlMs: 100, now: () => clock })

    tracker.set('/repo/done', { phase: 'ready', prefix: 'done', name: 'Done' })
    tracker.set('/repo/busy', { phase: 'analyzing' })

    clock = 1050 // within TTL — both visible
    expect(
      tracker
        .list()
        .map((s) => s.path)
        .sort(),
    ).toEqual(['/repo/busy', '/repo/done'])

    clock = 1200 // terminal entry now past TTL; in-flight stays
    expect(tracker.list().map((s) => s.path)).toEqual(['/repo/busy'])
  })
})
