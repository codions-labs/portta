// Protecting a project hostname or a share, through the ForwardAuth service.
//
// Its own group, and its own file, because it is not the panel's
// authentication: the panel signs people in itself. This puts a credential in
// front of an application Portta routes but does not own, and the consumer
// project opts into it with a Traefik label of its own.

import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import {
  hashPassword,
  normalizeProtectionHost,
  protectionForHost,
  readProtectionStore,
  removeProtection,
  renderAuthDynamic,
  setProtection,
  writeEnvFile,
  writeProtectionStore,
} from 'portta-core'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

function paths(command: Command): { store: string; dynamic: string } {
  const root = gatewayContext({ profile: globals(command).profile }).root
  return {
    store: join(root, 'state/auth/protections.json'),
    dynamic: join(root, 'config/traefik/dynamic/portta-auth.yaml'),
  }
}

function save(command: Command, store: ReturnType<typeof readProtectionStore>): void {
  const target = paths(command)
  mkdirSync(dirname(target.store), { recursive: true, mode: 0o700 })
  chmodSync(dirname(target.store), 0o700)
  mkdirSync(dirname(target.dynamic), { recursive: true })
  writeProtectionStore(target.store, store)
  writeEnvFile(target.dynamic, renderAuthDynamic(store))
}

function publicRecord(record: ReturnType<typeof protectionForHost>) {
  if (!record) return null
  const { hash: _hash, ...visible } = record
  return visible
}

export async function protectHost(
  hostInput: string,
  options: {
    user?: string
    passwordStdin?: boolean
    entrypoint?: string
    label?: string
    project?: string
    service?: string
  },
  command: Command,
): Promise<void> {
  const host = normalizeProtectionHost(hostInput)
  const user = options.user ?? 'reviewer'
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) throw new UsageError(`invalid username: ${user}`)
  const entryPoint =
    options.entrypoint ??
    (gatewayContext({ profile: globals(command).profile }).config.tlsEnabled ? 'websecure' : 'web')
  if (!/^[A-Za-z0-9_-]+$/.test(entryPoint)) throw new UsageError(`invalid entrypoint: ${entryPoint}`)
  const generated = options.passwordStdin !== true
  const password = generated
    ? randomBytes(20)
        .toString('base64url')
        .slice(0, 20)
        .match(/.{1,5}/g)!
        .join('-')
    : readFileSync(0, 'utf8').trim()
  if (!password) throw new UsageError('no password on stdin')

  const target = paths(command)
  const existing = readProtectionStore(target.store)
  const previous = protectionForHost(existing, host)
  const scope = previous?.scope ?? `host:${host}`
  const next = setProtection(existing, {
    scope,
    host,
    entryPoints: [entryPoint],
    user,
    hash: await hashPassword(password),
    label: options.label ?? options.service ?? host,
    ...(options.project ? { project: options.project } : {}),
    ...(options.service ? { service: options.service } : {}),
  })
  save(command, next)
  const output = new Output(globals(command))
  const result = {
    protection: publicRecord(protectionForHost(next, host)),
    generated,
    ...(generated ? { password } : {}),
  }
  if (output.json) output.data(result)
  else {
    output.line(`protected: ${host}`)
    output.line(`user: ${user}`)
    if (generated) {
      output.line(`password: ${password}`)
      output.warning('this is the only time the generated password is shown')
    }
    output.hint('add this middleware to the project router: portta-forward-auth@file')
  }
}

export async function unprotectHost(hostInput: string, command: Command): Promise<void> {
  const host = normalizeProtectionHost(hostInput)
  const target = paths(command)
  const current = readProtectionStore(target.store)
  const record = protectionForHost(current, host)
  if (!record) throw new UsageError(`host is not protected: ${host}`)
  save(command, removeProtection(current, record.scope))
  new Output(globals(command)).progress(`unprotected ${host}; project labels were not touched`)
}

export async function protectStatus(hostInput: string | undefined, command: Command): Promise<void> {
  const store = readProtectionStore(paths(command).store)
  const records = hostInput
    ? [protectionForHost(store, normalizeProtectionHost(hostInput))].filter((record) => record !== null)
    : store.protections
  const protections = records.map(publicRecord)
  const output = new Output(globals(command))
  if (output.json) output.data({ protections })
  else if (!protections.length) output.progress('no matching protected hosts')
  else
    for (const record of protections)
      output.line(`${record!.host}\t${record!.user}\t${record!.scope}\tepoch ${record!.epoch}`)
}

/**
 * Create the owner, from the host that runs the panel.
 *
 * The same endpoint the `/setup` page posts to, so there is one way for a first
 * user to exist. It is here because a panel bound to loopback on a server has no
 * browser to open it in, and because a provisioning script needs a way that does
 * not involve one.
 */
