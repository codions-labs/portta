// Deciding who may open a project hostname, through the ForwardAuth service.
//
// Its own group, and its own file, because it is not the panel's
// authentication: the panel signs people in itself. This puts a credential in
// front of an application Portta routes but does not own, or opens it to
// everybody. On a public host every routed service already passes through the
// ForwardAuth middleware, so the decision is only a record and changing it
// needs no recreate.

import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { normalizeProtectionHost, protectionForHost, readProtectionStore } from 'portta-core'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'
import { closedStore, exposurePaths, generatePassword, openStore, protectedStore, saveExposure } from './exposure.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

function entryPointFor(command: Command, requested?: string): string {
  const entryPoint =
    requested ?? (gatewayContext({ profile: globals(command).profile }).config.tlsEnabled ? 'websecure' : 'web')
  if (!/^[A-Za-z0-9_-]+$/.test(entryPoint)) throw new UsageError(`invalid entrypoint: ${entryPoint}`)
  return entryPoint
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
    passwordOnly?: boolean
    passwordStdin?: boolean
    entrypoint?: string
    label?: string
    project?: string
    service?: string
  },
  command: Command,
): Promise<void> {
  const host = normalizeProtectionHost(hostInput)
  if (options.passwordOnly === true && options.user !== undefined) {
    throw new UsageError('--password-only and --user ask for opposite things: pick one')
  }
  const user = options.passwordOnly === true ? null : (options.user ?? 'reviewer')
  if (user !== null && !/^[A-Za-z0-9._-]{1,64}$/.test(user)) throw new UsageError(`invalid username: ${user}`)
  const entryPoint = entryPointFor(command, options.entrypoint)
  const generated = options.passwordStdin !== true
  const password = generated ? generatePassword() : readFileSync(0, 'utf8').trim()
  if (!password) throw new UsageError('no password on stdin')

  const context = gatewayContext({ profile: globals(command).profile })
  const root = context.root
  const next = await protectedStore(readProtectionStore(exposurePaths(root).store), {
    host,
    entryPoint,
    user,
    password,
    ...(options.label ? { label: options.label } : {}),
    ...(options.project ? { project: options.project } : {}),
    ...(options.service ? { service: options.service } : {}),
  })
  saveExposure(root, next, context.config.profile)
  const output = new Output(globals(command))
  const result = {
    protection: publicRecord(protectionForHost(next, host)),
    generated,
    ...(generated ? { password } : {}),
  }
  if (output.json) output.data(result)
  else {
    output.line(`protected: ${host}`)
    output.line(user === null ? 'password only: no username is asked for' : `user: ${user}`)
    if (generated) {
      output.line(`password: ${password}`)
      output.warning('this is the only time the generated password is shown')
    }
    output.hint('on a public host this takes effect at once; elsewhere add portta-forward-auth@file to the router')
  }
}

export async function openHost(
  hostInput: string,
  options: { entrypoint?: string; label?: string; project?: string; service?: string },
  command: Command,
): Promise<void> {
  const host = normalizeProtectionHost(hostInput)
  const context = gatewayContext({ profile: globals(command).profile })
  const root = context.root
  const next = openStore(readProtectionStore(exposurePaths(root).store), {
    host,
    entryPoint: entryPointFor(command, options.entrypoint),
    ...(options.label ? { label: options.label } : {}),
    ...(options.project ? { project: options.project } : {}),
    ...(options.service ? { service: options.service } : {}),
  })
  saveExposure(root, next, context.config.profile)
  const output = new Output(globals(command))
  if (output.json) output.data({ protection: publicRecord(protectionForHost(next, host)) })
  else {
    output.line(`open to everybody: ${host}`)
    output.warning('no login is asked for this host; `portta protect host` puts one back')
  }
}

export async function unprotectHost(hostInput: string, command: Command): Promise<void> {
  const host = normalizeProtectionHost(hostInput)
  const context = gatewayContext({ profile: globals(command).profile })
  const root = context.root
  const next = closedStore(readProtectionStore(exposurePaths(root).store), host)
  if (!next) throw new UsageError(`host has no protection record: ${host}`)
  saveExposure(root, next, context.config.profile)
  new Output(globals(command)).progress(`removed the record for ${host}; on a public host it is now closed`)
}

export async function protectStatus(hostInput: string | undefined, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const root = context.root
  const store = readProtectionStore(exposurePaths(root).store)
  const records = hostInput
    ? [protectionForHost(store, normalizeProtectionHost(hostInput))].filter((record) => record !== null)
    : store.protections
  const protections = records.map(publicRecord)
  const output = new Output(globals(command))
  if (output.json) output.data({ protections })
  else if (!protections.length) output.progress('no matching hosts')
  else
    for (const record of protections)
      output.line(`${record!.host}\t${record!.mode}\t${record!.user ?? '-'}\t${record!.scope}\tepoch ${record!.epoch}`)
}
