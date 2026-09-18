import { describe, expect, it } from 'vitest'
import { emptyHost, type HostMetrics } from './metrics.ts'
import { hostPressure } from './pressure.ts'

function host(overrides: Partial<HostMetrics> = {}): HostMetrics {
  const base = emptyHost()
  base.cpu.logicalCores = 8
  base.cpuUtilisation = 0.2
  base.memoryUsedPercent = 0.4
  return { ...base, ...overrides }
}

describe('hostPressure', () => {
  it('says nothing when there is nothing to measure', () => {
    expect(hostPressure(null)).toEqual({ level: 'normal', reasons: [], measured: false })
  })

  it('refuses to judge a stale snapshot', () => {
    const verdict = hostPressure(host({ memoryUsedPercent: 0.99 }), { stale: true })
    expect(verdict.measured).toBe(false)
    expect(verdict.level).toBe('normal')
  })

  it('is normal on a host with room', () => {
    expect(hostPressure(host()).level).toBe('normal')
  })

  it('compares ratios against ratios, not percentages', () => {
    // The bug this replaced compared 0.93 against 90 and never fired.
    const verdict = hostPressure(host({ memoryUsedPercent: 0.94 }))
    expect(verdict.level).toBe('pressured')
    expect(verdict.reasons[0]).toEqual({ resource: 'memory', level: 'pressured', value: 0.94 })
  })

  it('notices a resource worth watching before it is worth acting on', () => {
    expect(hostPressure(host({ cpuUtilisation: 0.85 })).level).toBe('watch')
  })

  it('reaches critical only when two resources are past their high mark', () => {
    expect(hostPressure(host({ cpuUtilisation: 0.95 })).level).toBe('pressured')
    expect(hostPressure(host({ cpuUtilisation: 0.95, memoryUsedPercent: 0.95 })).level).toBe('critical')
  })

  it('treats memory plus swap as critical on its own', () => {
    const verdict = hostPressure(
      host({
        memoryUsedPercent: 0.94,
        swapTotalBytes: 8 * 1024 ** 3,
        swapUsedBytes: 6 * 1024 ** 3,
      }),
    )
    expect(verdict.level).toBe('critical')
  })

  it('reads load per core rather than raw load', () => {
    expect(hostPressure(host({ load: { one: 4, five: 4, fifteen: 4 } })).level).toBe('normal')
    const busy = host({ load: { one: 30, five: 30, fifteen: 30 } })
    expect(hostPressure(busy).reasons.some((reason) => reason.resource === 'load')).toBe(true)
  })

  it('ignores load when the core count is unknown', () => {
    const unknown = host({ load: { one: 40, five: 40, fifteen: 40 } })
    unknown.cpu = { ...unknown.cpu, logicalCores: null }
    expect(hostPressure(unknown).reasons.some((reason) => reason.resource === 'load')).toBe(false)
  })

  it('counts a draining battery as pressure and a charging one as none', () => {
    const draining = host({
      battery: {
        hasBattery: true,
        percent: 0.08,
        charging: false,
        acConnected: false,
        minutesRemaining: 12,
        cycleCount: 200,
      },
    })
    expect(hostPressure(draining).reasons.some((reason) => reason.resource === 'battery')).toBe(true)

    const charging = host({
      battery: {
        hasBattery: true,
        percent: 0.08,
        charging: true,
        acConnected: true,
        minutesRemaining: null,
        cycleCount: 200,
      },
    })
    expect(hostPressure(charging).level).toBe('normal')
  })

  it('reports a hot CPU without inventing one', () => {
    expect(hostPressure(host({ temperatureCelsius: null })).level).toBe('normal')
    expect(hostPressure(host({ temperatureCelsius: 96 })).reasons[0]?.resource).toBe('temperature')
  })
})
