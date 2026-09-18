import { Hono } from 'hono'
import { DatabaseMigrateResult } from 'portta-contracts'
import type { AppDeps } from '../../deps.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

export function databaseRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.post(
    '/database/migrate',
    documentRoute({
      tag: 'Configuration',
      // `gateway:read`, not an operate permission, and deliberately: this applies
      // the same checked-in SQL the process applies at boot, it is idempotent,
      // and it is what makes every read work at all. Read-only mode holds the
      // reads, so a panel that came up before its migrations can still recover
      // without being restarted.
      operationId: 'postDatabaseMigrate',
      permission: 'gateway:read',
      summary: 'Apply pending panel SQL migrations',
      description:
        'Idempotent. The same work the process does at start, so a file that appeared after boot can be applied without a restart. The CLI never opens the panel database itself.',
      response: DatabaseMigrateResult,
      errors: [403, 503],
    }),
    async (c) => {
      // Deliberately not behind `requireDatabase`: this is the endpoint that
      // *recovers* an unavailable database, so it runs against one and reports
      // 503 only if the run itself fails.
      const result = await deps.db.applyMigrations()
      // Only when something was actually applied: this endpoint is idempotent and
      // the CLI calls it on every `web up`, so a line per call would be a line
      // per start rather than a line per change.
      if (result.applied.length > 0) {
        await record(deps, c, {
          action: 'database.migrated',
          resourceType: 'database',
          resourceName: 'panel',
          metadata: { applied: result.applied },
        })
      }
      return c.json(result)
    },
  )

  return app
}
