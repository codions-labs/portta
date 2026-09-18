import { describe, expect, it } from 'vitest'
import { environmentHealth } from '@/lib/health'

describe('environment health', () => {
  it('is one word per situation', () => {
    expect(environmentHealth({ serviceCount: 4, runningCount: 4, unhealthyCount: 0 })).toBe('ok')
    expect(environmentHealth({ serviceCount: 4, runningCount: 2, unhealthyCount: 0 })).toBe('partial')
    expect(environmentHealth({ serviceCount: 4, runningCount: 0, unhealthyCount: 0 })).toBe('down')
    expect(environmentHealth({ serviceCount: 0, runningCount: 0, unhealthyCount: 0 })).toBe('down')
    expect(environmentHealth({ serviceCount: 4, runningCount: 4, unhealthyCount: 1 })).toBe('unhealthy')
  })
  it('counts a completed one-shot as fine, but not as running', () => {
    expect(environmentHealth({ serviceCount: 4, runningCount: 3, completedCount: 1, unhealthyCount: 0 })).toBe('ok')
    expect(environmentHealth({ serviceCount: 4, runningCount: 2, completedCount: 1, unhealthyCount: 0 })).toBe(
      'partial',
    )
    expect(environmentHealth({ serviceCount: 2, runningCount: 0, completedCount: 2, unhealthyCount: 0 })).toBe('down')
  })
})
