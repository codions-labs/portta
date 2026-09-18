import { describe, expect, it } from 'vitest'
import { buildControlBaseUrl } from '../runtime.ts'

// Regression: the host daemon mounts every project's routes under
// `/api/modules/taskflow/${prefix}`, so the control base URL that agent hooks
// POST to must carry both or the events reach no route and the agent's status
// never updates.
describe('buildControlBaseUrl', () => {
  it('points at the project under the module mount on the daemon', () => {
    expect(buildControlBaseUrl(5111, 'taskflow')).toBe('http://127.0.0.1:5111/api/modules/taskflow/taskflow')
  })

  it('follows a specific bind address and reaches a wildcard one on loopback', () => {
    expect(buildControlBaseUrl(5111, 'shop', '172.17.0.1')).toBe('http://172.17.0.1:5111/api/modules/taskflow/shop')
    expect(buildControlBaseUrl(5111, 'shop', '0.0.0.0')).toBe('http://127.0.0.1:5111/api/modules/taskflow/shop')
  })

  it('returns undefined when there is no prefix, disabling control reporting', () => {
    // The CLI passes undefined when it can't resolve a prefix (no daemon
    // running). No control URL is better than a wrong one: the agent's hooks
    // no-op cleanly instead of POSTing to an unrouted path.
    expect(buildControlBaseUrl(5111, undefined)).toBeUndefined()
    expect(buildControlBaseUrl(5111, '')).toBeUndefined()
  })
})
