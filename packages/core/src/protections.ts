import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export const PROTECTION_STORE_VERSION = 1 as const

export interface ProtectionTech {
  id: string
  label: string
}

export interface ProtectionRecord {
  scope: string
  host: string
  entryPoints: string[]
  user: string
  hash: string
  epoch: number
  label: string
  project?: string
  service?: string
  tech?: ProtectionTech
}

export interface ProtectionStore {
  version: typeof PROTECTION_STORE_VERSION
  protections: ProtectionRecord[]
}

export class InvalidProtectionStore extends Error {}

export function emptyProtectionStore(): ProtectionStore {
  return { version: PROTECTION_STORE_VERSION, protections: [] }
}

export function normalizeProtectionHost(input: string): string {
  const value = input.trim()
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are part of what a host must not contain
  if (value === '' || /[\u0000-\u0020\\/#?@]/.test(value) || value.includes('://')) {
    throw new InvalidProtectionStore(`invalid protection host: ${input}`)
  }
  let url: URL
  try {
    url = new URL(`http://${value}`)
  } catch {
    throw new InvalidProtectionStore(`invalid protection host: ${input}`)
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new InvalidProtectionStore(`invalid protection host: ${input}`)
  }
  const hostname = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname
  return `${hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
}

function nonEmpty(value: unknown, field: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a NUL or a line break must be refused, not matched around
  if (typeof value !== 'string' || value === '' || /[\r\n\u0000]/.test(value)) {
    throw new InvalidProtectionStore(`invalid ${field}`)
  }
  return value
}

function parseRecord(value: unknown): ProtectionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidProtectionStore('invalid protection record')
  const item = value as Record<string, unknown>
  const entryPoints = item.entryPoints
  if (
    !Array.isArray(entryPoints) ||
    entryPoints.length === 0 ||
    !entryPoints.every((entry) => typeof entry === 'string' && /^[A-Za-z0-9_-]+$/.test(entry))
  ) {
    throw new InvalidProtectionStore('invalid entryPoints')
  }
  if (!Number.isSafeInteger(item.epoch) || Number(item.epoch) < 1) throw new InvalidProtectionStore('invalid epoch')
  const record: ProtectionRecord = {
    scope: nonEmpty(item.scope, 'scope'),
    host: normalizeProtectionHost(nonEmpty(item.host, 'host')),
    entryPoints: [...new Set(entryPoints as string[])].sort(),
    user: nonEmpty(item.user, 'user'),
    hash: nonEmpty(item.hash, 'hash'),
    epoch: Number(item.epoch),
    label: nonEmpty(item.label, 'label'),
  }
  if (item.project !== undefined) record.project = nonEmpty(item.project, 'project')
  if (item.service !== undefined) record.service = nonEmpty(item.service, 'service')
  if (item.tech !== undefined) {
    if (!item.tech || typeof item.tech !== 'object' || Array.isArray(item.tech))
      throw new InvalidProtectionStore('invalid tech')
    const tech = item.tech as Record<string, unknown>
    record.tech = { id: nonEmpty(tech.id, 'tech.id'), label: nonEmpty(tech.label, 'tech.label') }
  }
  return record
}

export function parseProtectionStore(text: string): ProtectionStore {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new InvalidProtectionStore('protection store is not valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidProtectionStore('invalid protection store')
  const object = value as Record<string, unknown>
  if (object.version !== PROTECTION_STORE_VERSION || !Array.isArray(object.protections)) {
    throw new InvalidProtectionStore('unsupported protection store version')
  }
  const protections = object.protections.map(parseRecord)
  const scopes = new Set<string>()
  const hosts = new Set<string>()
  for (const protection of protections) {
    if (scopes.has(protection.scope))
      throw new InvalidProtectionStore(`duplicate protection scope: ${protection.scope}`)
    if (hosts.has(protection.host)) throw new InvalidProtectionStore(`duplicate protection host: ${protection.host}`)
    scopes.add(protection.scope)
    hosts.add(protection.host)
  }
  return {
    version: PROTECTION_STORE_VERSION,
    protections: protections.sort((left, right) => left.scope.localeCompare(right.scope)),
  }
}

export function readProtectionStore(path: string): ProtectionStore {
  if (!existsSync(path)) return emptyProtectionStore()
  return parseProtectionStore(readFileSync(path, 'utf8'))
}

export function writeProtectionStore(path: string, store: ProtectionStore): void {
  const canonical = parseProtectionStore(`${JSON.stringify(store)}\n`)
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${randomBytes(8).toString('hex')}.tmp`)
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function setProtection(
  store: ProtectionStore,
  input: Omit<ProtectionRecord, 'epoch' | 'host'> & { host: string },
): ProtectionStore {
  const host = normalizeProtectionHost(input.host)
  const previous = store.protections.find((item) => item.scope === input.scope)
  const collision = store.protections.find((item) => item.host === host && item.scope !== input.scope)
  if (collision) throw new InvalidProtectionStore(`host ${host} is already protected by ${collision.scope}`)
  const next: ProtectionRecord = {
    ...input,
    host,
    entryPoints: [...new Set(input.entryPoints)].sort(),
    epoch: (previous?.epoch ?? 0) + 1,
  }
  return parseProtectionStore(
    JSON.stringify({
      ...store,
      protections: [...store.protections.filter((item) => item.scope !== input.scope), next],
    }),
  )
}

export function removeProtection(store: ProtectionStore, scope: string): ProtectionStore {
  return { ...store, protections: store.protections.filter((item) => item.scope !== scope) }
}

export function protectionForHost(store: ProtectionStore, host: string): ProtectionRecord | null {
  const normalized = normalizeProtectionHost(host)
  return store.protections.find((item) => item.host === normalized) ?? null
}
