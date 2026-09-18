import { describe, expect, it } from 'vitest'
import { LoginLimiter } from './rate-limit.ts'

describe('login limiter', () => {
  it('delays progressively and locks the fifth failure for fifteen minutes', async () => {
    let now = 1_000_000
    const waits: number[] = []
    const limiter = new LoginLimiter({
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds)
      },
    })
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await limiter.failure('scope\0ip')).allowed).toBe(true)
    const locked = await limiter.failure('scope\0ip')
    expect(locked.allowed).toBe(false)
    expect(locked.retryAfter).toBe(900)
    expect(waits).toEqual([250, 500, 1000, 2000, 4000])
    now += 900_001
    expect(limiter.check('scope\0ip').allowed).toBe(true)
  })

  it('clears a bucket after success', async () => {
    const limiter = new LoginLimiter({ wait: async () => undefined })
    await limiter.failure('key')
    limiter.success('key')
    expect(limiter.check('key').allowed).toBe(true)
  })
})
