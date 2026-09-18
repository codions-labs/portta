import type { Auth, PrincipalResolver, SecurityConfig } from 'portta-auth-core'
import type { PanelConfig } from './config.ts'
import type { Database } from './db/index.ts'
import type { ServerModule } from './modules/index.ts'
import type { LiveHub } from './realtime/hub.ts'
import type { DockerClient } from './services/docker/client.ts'
import type { SnapshotCache } from './services/inventory.ts'
import type { ForgeClient } from './services/issues/host-client.ts'
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
  /**
   * The way to the host daemon's forge surface, which is where `gh` and Linear
   * are (ADR 0018, ADR 0047).
   *
   * Not optional, and not null when the daemon is down: the client itself is
   * always constructible, and a daemon that cannot be reached is a typed
   * failure on the call rather than an absent dependency every route would have
   * to check for.
   */
  forge: ForgeClient
  /** Whether the panel asks who you are, decided once at boot. */
  security: SecurityConfig
  /**
   * Better Auth, or null in `open` mode where it is never built: there is
   * nothing to sign in to, and `/api/auth/*` answers 404 except for the status.
   */
  auth: Auth | null
  /** Who a request is, from what it carries. The one answer the API trusts. */
  principals: PrincipalResolver
  /**
   * The official modules this process mounts. Absent means every registered
   * module; a suite passes its own.
   */
  modules?: readonly ServerModule[]
}
