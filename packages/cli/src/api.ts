// The one HTTP client the CLI has for the panel.
//
// Local facts come from core, executed locally; persistent decisions come from
// the API. Every command that needs a decision — a Project, a session —
// goes through here, so the credential handling, the loopback refusal and the
// way a refusal is worded exist once. `portta mcp` wraps the same client.

import { describeFailure, type HttpMethod } from 'portta-mcp'
import type { GatewayContext } from './context.js'
import { findCredential } from './credentials.js'
import { CliError, EXIT, PreconditionError, RefusedError } from './errors.js'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopbackUrl(raw: string): boolean {
  try {
    return LOOPBACK.has(new URL(raw).hostname)
  } catch {
    return false
  }
}

/**
 * Where the panel is, and whether we are allowed to send a credential there.
 *
 * The failure worth designing for is a misconfigured URL sending a panel
 * credential somewhere unintended, so a non-loopback panel is refused unless
 * the operator says so explicitly — which is how the rest of Portta treats
 * exposure.
 */
export function resolvePanelUrl(
  env: Record<string, string | undefined>,
  options: { url?: string; allowRemote?: boolean },
  fallbackPort: string,
): string {
  const raw = options.url ?? env.PORTTA_URL ?? `http://127.0.0.1:${fallbackPort}`
  const url = raw.replace(/\/+$/, '')
  if (!isLoopbackUrl(url) && !options.allowRemote) {
    throw new RefusedError(
      `refusing to send a panel credential to ${url}`,
      'pass --allow-remote if that is deliberate; the panel is loopback by default for this reason',
    )
  }
  return url
}

/**
 * The credential this command sends, and where it came from.
 *
 * Precedence is deliberate and is the order of how explicit each source is:
 * `--token` on this invocation, then `PORTTA_TOKEN` in this environment, then
 * whatever `portta auth login` saved for this panel. A panel in `disabled` mode
 * needs none of them and gets none.
 *
 * Never logged, never echoed, never put on a command line by this process.
 */
export function panelHeaders(
  env: Record<string, string | undefined>,
  actor: string,
  actorKind?: 'human' | 'agent',
  options: { url?: string; token?: string } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-Portta-Actor': actor,
    'X-Portta-Source': 'cli',
  }
  if (actorKind) headers['X-Portta-Actor-Kind'] = actorKind
  const stored = options.url ? findCredential(options.url)?.token : undefined
  const token = options.token ?? env.PORTTA_TOKEN ?? stored
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

export type { HttpMethod }
// How a panel answer becomes a sentence is decided once, in `portta-mcp`,
// because the panel's own MCP transport words a refusal the same way.
export { describeFailure }

export interface PanelAnswer {
  ok: boolean
  status: number
  text: string
}

export class PanelClient {
  readonly url: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number

  constructor(url: string, headers: Record<string, string>, timeoutMs = 15_000) {
    this.url = url
    this.headers = headers
    this.timeoutMs = timeoutMs
  }

  /** One request, answered as it came. Only a transport failure throws. */
  async answer(method: HttpMethod, path: string, body?: unknown): Promise<PanelAnswer> {
    let response: Response
    try {
      response = await fetch(`${this.url}/api${path}`, {
        method,
        headers: this.headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new PreconditionError(
        `the panel at ${this.url} did not answer: ${error instanceof Error ? error.message : String(error)}`,
        'start it with `portta web up`, or point --url at the panel',
      )
    }
    return { ok: response.ok, status: response.status, text: await response.text() }
  }

  /** One request that must succeed; a refusal becomes a CLI error with the panel's words. */
  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const answer = await this.answer(method, path, body)
    if (!answer.ok) {
      const message = describeFailure(answer.status, answer.text)
      if (answer.status === 401 || answer.status === 403) throw new RefusedError(message)
      if (answer.status === 503) throw new PreconditionError(message)
      throw new CliError(message, answer.status === 404 || answer.status === 400 ? EXIT.usage : EXIT.failure)
    }
    if (answer.text.trim() === '') return undefined as T
    return JSON.parse(answer.text) as T
  }
}

export interface PanelOptions {
  url?: string
  allowRemote?: boolean
  actor?: string
  actorKind?: 'human' | 'agent'
  /** This invocation's token, ahead of the environment and the saved one. */
  token?: string
}

/**
 * Who is at the other end of this command, when nobody said.
 *
 * A person. The panel narrows a request that announces itself as an agent to
 * what agents may do, and it treats an actor with no declared kind as one —
 * which is the right default for a bare header on the API, and the wrong one
 * here: `portta projects create` is somebody typing, and being silently
 * narrowed to what an agent holds made it answer 403 on a panel where the
 * operator holds everything.
 *
 * An agent driving the CLI says so with PORTTA_ACTOR_KIND=agent, and `portta
 * mcp` — the surface that exists for agents — declares it outright.
 */
function declaredKind(env: NodeJS.ProcessEnv): 'human' | 'agent' {
  return env.PORTTA_ACTOR_KIND === 'agent' ? 'agent' : 'human'
}

/** What a command sends, composed where a test can read it back. */
export function panelRequestHeaders(context: GatewayContext, options: PanelOptions = {}): Record<string, string> {
  const url = resolvePanelUrl(context.env, options, context.env.PORTTA_WEB_PORT ?? '8081')
  const actor =
    options.actor ?? context.env.PORTTA_ACTOR ?? context.env.PORTTA_MCP_ACTOR ?? process.env.USER ?? 'operator'
  const actorKind = options.actorKind ?? declaredKind(context.env)
  return panelHeaders(context.env, actor, actorKind, { url, ...(options.token ? { token: options.token } : {}) })
}

/** The client a command uses, from the gateway context it already has. */
export function panelClient(context: GatewayContext, options: PanelOptions = {}): PanelClient {
  const url = resolvePanelUrl(context.env, options, context.env.PORTTA_WEB_PORT ?? '8081')
  return new PanelClient(url, panelRequestHeaders(context, options))
}

/** `owner/repo#number` and a slug both have to survive a path segment. */
export function segment(value: string): string {
  return encodeURIComponent(value)
}
