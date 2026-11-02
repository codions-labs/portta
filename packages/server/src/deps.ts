import type { Auth, PrincipalResolver, SecurityConfig } from 'portta-auth-core'
import type { PanelConfig } from './config.ts'
import type { Database } from './db/index.ts'
import type { LiveHub } from './realtime/hub.ts'
import type { DockerClient } from './services/docker/client.ts'
import type { SnapshotCache } from './services/inventory.ts'
import type { VerdictCache } from './services/traefik.ts'

export interface AppDeps {
  config: PanelConfig
  client: DockerClient
  cache: SnapshotCache
  hub: LiveHub
  /** Traefik's own view, on its own cache. Never on the snapshot path. */
  verdict: VerdictCache
  /**
   * Required. The database is a boot dependency: `main` exits rather than
   * serving a panel that cannot remember anything. A file that becomes
   * unreadable *after* boot is a different thing, and `requireDatabase` still
   * turns it into a 503.
   */
  db: Database
  /** Whether the panel asks who you are, decided once at boot. */
  security: SecurityConfig
  /**
   * Better Auth, or null in `open` mode where it is never built: there is
   * nothing to sign in to, and `/api/auth/*` answers 404 except for the status.
   */
  auth: Auth | null
  /** Who a request is, from what it carries. The one answer the API trusts. */
  principals: PrincipalResolver
}
