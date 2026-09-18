// The panel's way to the forge, which is the host daemon.
//
// Not `createHostProxy`. That forwards a request unchanged, and the panel does
// not want to forward: it has to decide which repository a Project means,
// project what the daemon answered into the contract, and fold in the
// environment links that are Portta's own. So this is an ordinary typed client
// to `/api/forge/*` — the daemon's token goes on the request, and nothing the
// browser sent reaches it (ADR 0047).
//
// The daemon may be absent. That is not an error state to hide: a Portta with
// no `portta host serve` running simply cannot read issues, and the panel says
// exactly that rather than rendering an empty list.

import type { ForgeStatus, ProviderStatus } from 'portta-contracts'
import type { PanelConfig } from '../../config.ts'
import { readHostToken } from '../../modules/proxy.ts'

/** The vocabulary the daemon answers with, repeated here so the panel can switch on it. */
export type ForgeFailure =
  | 'unavailable'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'failed'
  /** The daemon itself, rather than the provider behind it. */
  | 'daemon-unreachable'

export class ForgeUnavailable extends Error {
  readonly kind: ForgeFailure
  readonly hint: string | null

  constructor(kind: ForgeFailure, message: string, hint: string | null = null) {
    super(message)
    this.name = 'ForgeUnavailable'
    this.kind = kind
    this.hint = hint
  }
}

/** What each failure means as an HTTP answer from the panel's own API. */
export const FORGE_HTTP_STATUS: Record<ForgeFailure, 400 | 401 | 403 | 404 | 429 | 502 | 503 | 504> = {
  unavailable: 503,
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  'rate-limited': 429,
  timeout: 504,
  failed: 502,
  'daemon-unreachable': 503,
}

export interface ForgeClientConfig extends Pick<PanelConfig, 'hostUrl' | 'hostTokenFile'> {}

export interface ForgeRequest {
  path: string
  method?: 'GET' | 'POST' | 'PATCH'
  query?: Record<string, string | number | undefined>
  body?: unknown
}

const DAEMON_HINT = 'start it with portta host serve, or portta host service install'

export interface ForgeClient {
  call<T>(request: ForgeRequest): Promise<T>
}

export function createForgeClient(config: ForgeClientConfig, request: typeof fetch = fetch): ForgeClient {
  return {
    async call<T>({ path, method = 'GET', query, body }: ForgeRequest): Promise<T> {
      if (!config.hostUrl) {
        throw new ForgeUnavailable('daemon-unreachable', 'the host daemon is not configured', 'set PORTTA_HOST_URL')
      }
      const token = readHostToken(config.hostTokenFile)
      if (!token) {
        throw new ForgeUnavailable(
          'daemon-unreachable',
          `the host daemon token is not readable at ${config.hostTokenFile}`,
          DAEMON_HINT,
        )
      }

      const url = new URL(`${config.hostUrl.replace(/\/+$/, '')}/api/forge${path}`)
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
      }

      let response: Response
      try {
        response = await request(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch (error) {
        throw new ForgeUnavailable(
          'daemon-unreachable',
          `the host daemon is not reachable: ${String(error)}`,
          DAEMON_HINT,
        )
      }

      if (response.ok) return (await response.json()) as T

      // The daemon's own error shape. Anything else — a proxy's HTML, a
      // truncated body — is reported as a failure rather than parsed hopefully.
      const detail = (await response.json().catch(() => null)) as {
        error?: string
        kind?: ForgeFailure
        hint?: string | null
      } | null
      throw new ForgeUnavailable(
        detail?.kind ?? 'failed',
        detail?.error ?? `the host daemon answered ${response.status}`,
        detail?.hint ?? null,
      )
    },
  }
}

/** What the daemon answers with. `detail` is its word; the contract's is `reason`. */
interface DaemonProviderStatus {
  available: boolean
  authenticated: boolean
  account: string | null
  detail: string | null
}

/**
 * Whether the host can operate either provider, in the contract's shape.
 *
 * Renaming `detail` to `reason` here rather than at each caller: a caller that
 * spread the daemon's object and added `reason` would leave `detail` on it and
 * fail the response contract. One projection, at the boundary the daemon's
 * vocabulary stops at.
 *
 * Never throws: a diagnostic that fails is a diagnostic nobody can read, so a
 * daemon that cannot be reached is reported as both providers being
 * unavailable, with the reason.
 */
export async function forgeStatus(client: ForgeClient): Promise<ForgeStatus> {
  const project = (status: DaemonProviderStatus): ProviderStatus => ({
    available: status.available,
    authenticated: status.authenticated,
    account: status.account,
    reason: status.detail,
  })
  try {
    const answer = await client.call<{ github: DaemonProviderStatus; linear: DaemonProviderStatus }>({
      path: '/status',
    })
    return { github: project(answer.github), linear: project(answer.linear) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const down: ProviderStatus = { available: false, authenticated: false, account: null, reason }
    return { github: down, linear: { ...down } }
  }
}
