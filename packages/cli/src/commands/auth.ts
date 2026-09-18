// Who this terminal is, to a panel.
//
// `login` validates a token against the panel it is for and saves it; `status`
// says who that makes you; `logout` forgets it. The credential store is one
// file per host, not one per project, because a token is a person's and follows
// them between checkouts.
//
// Protecting a project hostname is `portta protect`: a different question,
// answered by a different process. See commands/protect.ts.

import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { PanelClient, panelHeaders, resolvePanelUrl } from '../api.js'
import { gatewayContext } from '../context.js'
import { findCredential, forgetCredential, panelKey, readCredentials, saveCredential } from '../credentials.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { clientFor } from './work.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
    url?: string
    allowRemote?: boolean
    token?: string
  }
}

interface Me {
  kind: string
  name: string
  email: string | null
  role: string
  actor: string
  permissions: string[]
  scope: 'all' | number[]
  projects: { slug: string }[]
  tokenId: string | null
}

/** The panel this invocation is talking about, with the loopback rule applied. */
function panelUrlFor(command: Command): string {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile, required: false })
  return resolvePanelUrl(
    context.env,
    { ...(global.url ? { url: global.url } : {}), ...(global.allowRemote ? { allowRemote: true } : {}) },
    context.env.PORTTA_WEB_PORT ?? '8081',
  )
}

export async function authBootstrap(
  options: { name?: string; email?: string; passwordStdin?: boolean },
  command: Command,
): Promise<void> {
  if (!options.name || !options.email) throw new UsageError('--name and --email are required')
  // Never an argument: a password on the command line is in the shell history,
  // in `ps`, and in whatever collects both.
  const password = options.passwordStdin ? readFileSync(0, 'utf8').trim() : ''
  if (!password)
    throw new UsageError(
      'the password is read from stdin',
      'printf %s "$PASSWORD" | portta auth bootstrap --name … --email … --password-stdin',
    )
  if (password.length < 10) throw new UsageError('the password must be at least 10 characters')

  const { client, output } = clientFor(command, { actor: undefined, actorKind: 'human' })
  const body = await client.request<{ ok: true; user: { id: string; email: string; name: string } }>(
    'POST',
    '/auth/setup',
    { name: options.name, email: options.email, password },
  )
  if (output.json) return output.data(body)
  output.progress(`created ${body.user.email} as the owner`)
  output.hint('sign in at the panel URL; there is no password reset by email')
}

/**
 * Save a token for a panel, after checking that it is one.
 *
 * The check is the point: a token saved without it is a file that looks right
 * and fails on the next command, at which moment nobody remembers this one. The
 * secret is read from a TTY without echoing, or from `--token`, and is never
 * printed back.
 */
export async function authLogin(options: { token?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const url = panelUrlFor(command)
  const token = options.token ?? global.token ?? (await readSecret())
  if (!token)
    throw new UsageError(
      'a token is required',
      'create one in Settings → API tokens, or with `portta auth token create`',
    )
  if (!token.startsWith('ptt_')) throw new UsageError('that does not look like a Portta token', 'they begin with ptt_')

  const client = new PanelClient(url, panelHeaders({}, 'cli', 'human', { token }))
  const me = await client.request<Me>('GET', '/auth/me').catch((error: unknown) => {
    if (error instanceof RefusedError) {
      throw new RefusedError(
        `${url} did not accept that token`,
        'check it was copied whole, and that it has not been revoked',
      )
    }
    throw error
  })

  saveCredential(url, { token, user: me.email ?? me.name, role: me.role, savedAt: new Date().toISOString() })
  if (output.json) return output.data({ url, user: me.email ?? me.name, role: me.role })
  output.progress(`signed in to ${url} as ${me.email ?? me.name} (${me.role})`)
}

/**
 * The password prompt, with the echo off.
 *
 * Not a `--token` default: a token on a command line is in the shell history,
 * in `ps`, and in whatever collects both. Without a TTY there is nothing to
 * prompt, and the caller is told which flag to use instead.
 */
async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    const piped = readFileSync(0, 'utf8').trim()
    if (piped) return piped
    throw new UsageError('no token on stdin', 'pass --token, or run this in a terminal')
  }
  process.stderr.write('token: ')
  const previous = process.stdin.isRaw
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  let typed = ''
  try {
    for await (const chunk of process.stdin) {
      const text = String(chunk)
      if (text.includes('\u0003')) throw new UsageError('cancelled')
      const end = text.indexOf('\r') >= 0 || text.indexOf('\n') >= 0
      typed += end
        ? text.slice(0, Math.min(...[text.indexOf('\r'), text.indexOf('\n')].filter((index) => index >= 0)))
        : text
      if (end) break
    }
  } finally {
    process.stdin.setRawMode?.(previous ?? false)
    process.stdin.pause()
    process.stderr.write('\n')
  }
  return typed.trim()
}

export async function authStatus(_options: unknown, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const url = panelUrlFor(command)

  const status = await new PanelClient(url, { 'content-type': 'application/json' }).request<{
    mode: string
    setupRequired: boolean
  }>('GET', '/auth/status')

  if (status.mode === 'open') {
    if (output.json) return output.data({ url, mode: 'open', signedIn: false })
    output.line(`${url}: open — every request is the local operator, and no credential is needed`)
    return
  }
  if (status.setupRequired) {
    if (output.json) return output.data({ url, mode: 'protected', setupRequired: true, signedIn: false })
    output.line(`${url}: waiting for its first user`)
    output.hint(`open ${url}/setup, or run portta auth bootstrap`)
    return
  }

  const stored = findCredential(url)
  const { client } = clientFor(command)
  const me = await client.request<Me>('GET', '/auth/me').catch((error: unknown) => {
    if (error instanceof RefusedError) return null
    throw error
  })
  if (!me) {
    if (output.json) return output.data({ url, mode: 'protected', signedIn: false })
    output.line(`${url}: not signed in`)
    output.hint(`portta auth login --url ${url}`)
    return
  }

  const value = {
    url,
    mode: 'protected',
    signedIn: true,
    user: me.email ?? me.name,
    role: me.role,
    kind: me.kind,
    projects: me.scope === 'all' ? 'all' : me.projects.map((project) => project.slug),
    permissions: me.permissions.length,
    savedAt: stored?.savedAt ?? null,
  }
  if (output.json) return output.data(value)
  output.line(`${url}: ${value.user} (${value.role}, via ${value.kind})`)
  output.line(`projects: ${value.projects === 'all' ? 'all' : (value.projects as string[]).join(', ') || 'none'}`)
  output.line(`permissions: ${value.permissions}`)
}

export async function authLogout(_options: unknown, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const url = panelUrlFor(command)
  const forgotten = forgetCredential(url)
  if (output.json) return output.data({ url, forgotten })
  // The token itself is still valid: forgetting it here is not revoking it, and
  // saying so is the difference between a tidy laptop and a false sense of it.
  if (forgotten) {
    output.progress(`forgot the credential for ${url}`)
    output.hint('the token itself still works; revoke it with `portta auth token revoke <id>`')
  } else {
    output.line(`no saved credential for ${url}`)
  }
}

/** Every panel this host has a credential for, and for whom. Never the secrets. */
export async function authWhoami(_options: unknown, command: Command): Promise<void> {
  const output = new Output(globals(command))
  const store = readCredentials()
  const rows = Object.entries(store.panels).map(([url, credential]) => ({
    url,
    user: credential.user,
    role: credential.role,
    savedAt: credential.savedAt,
  }))
  if (output.json) return output.data({ panels: rows })
  if (rows.length === 0) {
    output.line('no saved credentials')
    return
  }
  for (const row of rows) output.line(`${row.url}\t${row.user}\t${row.role}`)
}

interface TokenView {
  id: string
  name: string
  start: string | null
  actorKind: string
  scopes: string[]
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
  enabled: boolean
  user: string
}

export async function authTokenList(options: { all?: boolean }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ tokens: TokenView[] }>('GET', `/auth/tokens${options.all ? '?all=true' : ''}`)
  if (output.json) return output.data(body)
  if (body.tokens.length === 0) return output.line('no tokens')
  for (const token of body.tokens) {
    output.line([token.id, token.enabled ? 'active' : 'revoked', token.actorKind, token.name, token.user].join('\t'))
  }
}

export async function authTokenCreate(
  options: { name?: string; human?: boolean; scopes?: string; expiresInDays?: string },
  command: Command,
): Promise<void> {
  if (!options.name) throw new UsageError('--name is required')
  const { client, output } = clientFor(command)
  const body = await client.request<{ token: string; credential: TokenView }>('POST', '/auth/tokens', {
    name: options.name,
    actorKind: options.human ? 'human' : 'agent',
    ...(options.scopes
      ? {
          scopes: options.scopes
            .split(',')
            .map((scope) => scope.trim())
            .filter(Boolean),
        }
      : {}),
    ...(options.expiresInDays ? { expiresInDays: Number(options.expiresInDays) } : {}),
  })
  if (output.json) return output.data(body)
  output.line(`token: ${body.token}`)
  output.warning('this is the only time the token is shown')
  output.hint('save it with `portta auth login --token …`, or set PORTTA_TOKEN for one command')
}

export async function authTokenRevoke(id: string, _options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  await client.request('DELETE', `/auth/tokens/${encodeURIComponent(id)}`)
  output.progress(`revoked ${id}`)
  void panelKey
  void PreconditionError
}
