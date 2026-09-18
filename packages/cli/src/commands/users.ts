// The panel's accounts, from a terminal.
//
// Every one of these is the API doing the work: the rules about who may act on
// whom live in the panel, once, and a CLI that checked them itself would be a
// second opinion that could disagree. What this adds is a shape a person can
// read and a password that never reaches a command line.

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { isRole, ROLES } from 'portta-core'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { clientFor, csv, table } from './work.js'

interface UserView {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  projects: { id: string; slug: string }[]
}

/**
 * A password, from stdin or generated.
 *
 * Never an argument, and never a prompt with an echo: a password on a command
 * line is in the shell history, in `ps`, and in whatever collects both.
 */
function passwordFrom(options: { passwordStdin?: boolean }): { password: string; generated: boolean } {
  if (options.passwordStdin) {
    const password = readFileSync(0, 'utf8').trim()
    if (!password) throw new UsageError('no password on stdin')
    if (password.length < 10) throw new UsageError('the password must be at least 10 characters')
    return { password, generated: false }
  }
  // Twenty characters over a thirty-two symbol alphabet: about a hundred bits,
  // and readable enough to be typed once into a password manager.
  const password = randomBytes(20)
    .toString('base64url')
    .slice(0, 20)
    .match(/.{1,5}/g)!
    .join('-')
  return { password, generated: true }
}

function line(user: UserView): string[] {
  return [
    user.email,
    user.role,
    user.banned ? 'banned' : 'active',
    user.projects.length ? user.projects.map((project) => project.slug).join(',') : 'all',
    user.id,
  ]
}

export async function usersList(_options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ users: UserView[] }>('GET', '/users')
  if (output.json) return output.data(body)
  if (body.users.length === 0) return output.line('no users')
  table(output, [['EMAIL', 'ROLE', 'STATE', 'PROJECTS', 'ID'], ...body.users.map(line)])
}

export async function usersCreate(
  options: { name?: string; email?: string; role?: string; projects?: string; passwordStdin?: boolean },
  command: Command,
): Promise<void> {
  if (!options.name || !options.email) throw new UsageError('--name and --email are required')
  const role = options.role ?? 'viewer'
  if (!isRole(role)) throw new UsageError(`--role must be one of: ${ROLES.join(', ')}`)
  const { password, generated } = passwordFrom(options)

  const { client, output } = clientFor(command)
  const created = await client.request<UserView>('POST', '/users', {
    name: options.name,
    email: options.email,
    password,
    role,
    ...(options.projects ? { projects: (csv(options.projects) ?? []).map(Number) } : {}),
  })
  if (output.json) return output.data({ ...created, password: generated ? password : undefined })
  output.line(`${created.email}  ${created.role}`)
  if (generated) {
    output.line(`password: ${password}`)
    output.warning('this is the only time the generated password is shown')
  }
}

export async function usersSetRole(email: string, role: string, _options: unknown, command: Command): Promise<void> {
  if (!isRole(role)) throw new UsageError(`role must be one of: ${ROLES.join(', ')}`)
  const { client, output } = clientFor(command)
  const target = await find(client, email)
  const updated = await client.request<UserView>('PATCH', `/users/${encodeURIComponent(target.id)}/role`, { role })
  if (output.json) return output.data(updated)
  output.progress(`${updated.email} is now ${updated.role}`)
}

export async function usersSetPassword(
  email: string,
  options: { passwordStdin?: boolean },
  command: Command,
): Promise<void> {
  const { password, generated } = passwordFrom(options)
  const { client, output } = clientFor(command)
  const target = await find(client, email)
  await client.request('PATCH', `/users/${encodeURIComponent(target.id)}/password`, { password })
  if (output.json) return output.data({ email: target.email, password: generated ? password : undefined })
  output.progress(`password set for ${target.email}; every session of that account was ended`)
  if (generated) {
    output.line(`password: ${password}`)
    output.warning('this is the only time the generated password is shown')
  }
}

/**
 * Which Projects somebody reaches.
 *
 * The API takes the whole list every time, because "these are the Projects" is
 * the sentence a person means. Grant and revoke are that sentence with one
 * entry added or removed, computed here so the terminal has the verb it wants
 * and the panel keeps the shape that cannot race.
 */
async function reshape(
  email: string,
  slug: string,
  command: Command,
  change: (held: string[], id: string) => string[],
): Promise<void> {
  const { client, output } = clientFor(command)
  const target = await find(client, email)
  const projects = await client.request<{ projects: { id: string; slug: string }[] }>('GET', '/projects')
  const wanted = projects.projects.find((project) => project.slug === slug)
  if (!wanted) throw new UsageError(`no project '${slug}'`, 'list them with `portta projects list`')

  const held = target.projects.map((project) => project.id)
  const updated = await client.request<UserView>('PUT', `/users/${encodeURIComponent(target.id)}/projects`, {
    projects: change(held, wanted.id).map(Number),
  })
  if (output.json) return output.data(updated)
  const reached = updated.projects.map((project) => project.slug)
  output.progress(`${updated.email} reaches ${reached.length ? reached.join(', ') : 'no project'}`)
}

export async function usersGrant(email: string, slug: string, _options: unknown, command: Command): Promise<void> {
  await reshape(email, slug, command, (held, id) => [...new Set([...held, id])])
}

export async function usersRevoke(email: string, slug: string, _options: unknown, command: Command): Promise<void> {
  await reshape(email, slug, command, (held, id) => held.filter((entry) => entry !== id))
}

export async function usersRemove(email: string, _options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const target = await find(client, email)
  await client.request('DELETE', `/users/${encodeURIComponent(target.id)}`)
  output.progress(`removed ${target.email}`)
}

/** The API takes ids; a person types an email. */
async function find(client: ReturnType<typeof clientFor>['client'], email: string): Promise<UserView> {
  const body = await client.request<{ users: UserView[] }>('GET', '/users')
  const found = body.users.find((user) => user.email.toLowerCase() === email.trim().toLowerCase())
  if (!found) throw new UsageError(`no account with the email ${email}`, 'list them with `portta users list`')
  return found
}

/**
 * The way back in, when nobody can sign in to do it through the panel.
 *
 * Runs inside the panel's own container, where the database URL and the auth
 * configuration already are. It is not an API call on purpose: the case it
 * exists for is the one where no credential works.
 */
export async function authResetPassword(
  email: string,
  options: { passwordStdin?: boolean },
  command: Command,
): Promise<void> {
  const global = command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
  const output = new Output(global)
  gatewayContext({ profile: global.profile })
  const panel = (await inspectContainers()).find((container) => container.labels['portta.component'] === 'web')
  if (panel?.state !== 'running') {
    throw new PreconditionError('the panel is not running', 'run portta web up')
  }

  const { password, generated } = passwordFrom(options)
  const result = await runProcess('docker', ['exec', '-i', panel.name, 'node', 'dist/reset-password.mjs', email], {
    input: new TextEncoder().encode(`${password}\n`),
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new PreconditionError((result.stderr || result.stdout).trim() || 'the password could not be reset')
  }
  if (output.json) return output.data({ email, password: generated ? password : undefined })
  output.progress(`password set for ${email}; every session of that account was ended`)
  if (generated) {
    output.line(`password: ${password}`)
    output.warning('this is the only time the generated password is shown')
  }
}
