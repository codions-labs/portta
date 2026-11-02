// Hourly housekeeping: expired tokens and old audit entries are pruned.

import { collectTokens } from 'portta-auth-core'
import type { Database } from '../db/index.ts'
import { collectAudit } from './audit.ts'

export function createMaintenance(db: Database): {
  tick(): Promise<void>
  start(intervalMs?: number): void
  stop(): void
} {
  let timer: NodeJS.Timeout | null = null
  async function tick(): Promise<void> {
    if (!db.status().available) return
    try {
      // Tokens that expired a month ago are switched off, and ones revoked a
      // quarter ago are dropped. Neither can end a token somebody is using:
      // both thresholds are long past the moment the token stopped working.
      await collectTokens(db.handle)
      // And audit entries past the retention window. The log answers "who did
      // that" about something noticed months later, not years later, and an
      // unbounded table on a development host is a table nobody prunes by hand.
      await collectAudit(db.handle)
    } catch (error) {
      process.stderr.write(`maintenance failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  return {
    tick,
    start(intervalMs = 60 * 60_000): void {
      if (timer !== null) return
      timer = setInterval(() => {
        void tick()
      }, intervalMs)
      timer.unref?.()
    },
    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}
