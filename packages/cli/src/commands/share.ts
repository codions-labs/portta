import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import {
  readEnvFile,
  readProtectionStore,
  renderAuthDynamic,
  renderShares,
  SHARES_MARKER,
  writeEnvFile,
  writeProtectionStore,
} from 'portta-core'
import { z } from 'portta-core/zod'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'

const Share = z
  .object({
    id: z.string(),
    mode: z.enum(['public', 'protected']),
    host: z.string(),
    entryPoint: z.string(),
    container: z.string(),
    port: z.number(),
    expiresAt: z.number(),
    user: z.string().nullable().optional(),
  })
  .passthrough()
type Share = z.infer<typeof Share>
function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}
function path(command: Command): string {
  return join(gatewayContext({ profile: globals(command).profile }).root, 'config/traefik/dynamic/portta-shares.yaml')
}
function root(command: Command): string {
  return gatewayContext({ profile: globals(command).profile }).root
}
function read(command: Command): Share[] {
  const file = path(command)
  if (!existsSync(file)) return []
  const line = readEnvFile(file)
    .split('\n')
    .find((candidate) => candidate.startsWith(SHARES_MARKER))
  return line ? z.array(Share).parse(JSON.parse(line.slice(SHARES_MARKER.length))) : []
}
function write(command: Command, shares: Share[]): void {
  writeEnvFile(path(command), renderShares(shares))
}
function removeScopes(command: Command, scopes: Set<string>): void {
  const gateway = root(command)
  const storePath = join(gateway, 'state/auth/protections.json')
  const store = readProtectionStore(storePath)
  const next = { ...store, protections: store.protections.filter((protection) => !scopes.has(protection.scope)) }
  writeProtectionStore(storePath, next)
  writeEnvFile(join(gateway, 'config/traefik/dynamic/portta-auth.yaml'), renderAuthDynamic(next))
}

export async function shareList(command: Command): Promise<void> {
  const shares = read(command)
  const output = new Output(globals(command))
  if (output.json) output.data({ shares })
  else if (!shares.length) output.progress('nothing is shared')
  else
    for (const share of shares)
      output.line(`${share.id}\t${share.mode}\t${share.host}\t${share.container}:${share.port}\t${share.expiresAt}`)
}
export async function shareRevoke(id: string, command: Command): Promise<void> {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new UsageError(`invalid share id: ${id}`)
  const shares = read(command)
  if (!shares.some((share) => share.id === id)) throw new UsageError(`no share ${id}`)
  write(
    command,
    shares.filter((share) => share.id !== id),
  )
  removeScopes(command, new Set([`share:${id}`]))
  new Output(globals(command)).progress(`share ${id} revoked; the project router was not touched`)
}
export async function shareGc(command: Command): Promise<void> {
  const shares = read(command)
  const now = Math.floor(Date.now() / 1000)
  const kept = shares.filter((share) => share.expiresAt > now)
  if (kept.length !== shares.length) {
    write(command, kept)
    removeScopes(command, new Set(shares.filter((share) => share.expiresAt <= now).map((share) => `share:${share.id}`)))
  }
  new Output(globals(command)).progress(`removed ${shares.length - kept.length} expired share(s)`)
}

export { renderShares }
