import 'server-only'
import { setupStatus } from 'portta-auth-core'
import { serverDeps } from '@/lib/server/deps'

/**
 * What the auth pages branch on, read on the server.
 *
 * Straight from the database rather than through `/api/auth/status`: a page
 * fetching its own panel's HTTP API during a render is a request the process
 * makes to itself, and one more thing that can be slow or fail.
 */
export async function authStatus() {
  const deps = serverDeps()
  return setupStatus(deps.db.handle, deps.security.mode)
}
