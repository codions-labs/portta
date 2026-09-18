export interface LimitResult {
  allowed: boolean
  retryAfter: number
}

interface Bucket {
  failures: number[]
  lockedUntil: number
}

export class LoginLimiter {
  readonly #buckets = new Map<string, Bucket>()
  readonly #now: () => number
  readonly #wait: (milliseconds: number) => Promise<void>

  constructor(options: { now?: () => number; wait?: (milliseconds: number) => Promise<void> } = {}) {
    this.#now = options.now ?? Date.now
    this.#wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  check(key: string): LimitResult {
    const now = this.#now()
    const bucket = this.#buckets.get(key)
    if (!bucket || bucket.lockedUntil <= now) return { allowed: true, retryAfter: 0 }
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000)) }
  }

  async failure(key: string): Promise<LimitResult> {
    const now = this.#now()
    const bucket = this.#buckets.get(key) ?? { failures: [], lockedUntil: 0 }
    bucket.failures = bucket.failures.filter((time) => time > now - 10 * 60_000)
    bucket.failures.push(now)
    if (bucket.failures.length >= 5) bucket.lockedUntil = now + 15 * 60_000
    this.#buckets.set(key, bucket)
    const delay = Math.min(4_000, 250 * 2 ** Math.max(0, bucket.failures.length - 1))
    await this.#wait(delay)
    return this.check(key)
  }

  success(key: string): void {
    this.#buckets.delete(key)
  }
}
