import type { ContainerRecord } from 'portta-core'
import { z } from 'portta-core/zod'
import { PreconditionError, UsageError } from './errors.js'
import { runProcess } from './process.js'

const Identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/

export function identifier(value: string, kind = 'Docker identifier'): string {
  if (!Identifier.test(value)) throw new UsageError(`invalid ${kind}: ${value}`)
  return value
}

const InspectSchema = z
  .object({
    Id: z.string(),
    Name: z.string(),
    Config: z
      .object({ Image: z.string(), Labels: z.record(z.string(), z.string()).nullable().optional() })
      .passthrough(),
    State: z
      .object({ Status: z.string(), Health: z.object({ Status: z.string() }).passthrough().nullable().optional() })
      .passthrough(),
    HostConfig: z.object({ NetworkMode: z.string().optional() }).passthrough().optional(),
    Mounts: z.array(z.object({ Source: z.string().optional(), RW: z.boolean().optional() }).passthrough()).optional(),
    NetworkSettings: z
      .object({
        Networks: z.record(z.string(), z.unknown()).nullable().optional(),
        Ports: z
          .record(
            z.string(),
            z.array(z.object({ HostIp: z.string().optional(), HostPort: z.string().optional() })).nullable(),
          )
          .nullable()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough()

/**
 * A missing `docker` binary and a daemon that does not answer are different
 * problems with different fixes, so they get different messages. Portta never
 * installs Docker itself.
 */
export async function requireDocker(): Promise<void> {
  const result = await runProcess('docker', ['info'], { reject: false })
  if (result.error)
    throw new PreconditionError(
      'the docker CLI is not installed',
      'install Docker Engine 24 or newer; Portta never installs Docker or invokes a system package manager',
    )
  if (result.exitCode !== 0)
    throw new PreconditionError('cannot talk to the Docker daemon', 'start Docker or check DOCKER_HOST')
}

export async function dockerOperatingSystem(): Promise<string | null> {
  const result = await runProcess('docker', ['info', '--format', '{{.OperatingSystem}}'], {
    reject: false,
    timeout: 8_000,
  })
  if (result.exitCode !== 0) return null
  const value = result.stdout.trim()
  return value === '' ? null : value
}

export interface DockerStatsRow {
  id: string
  name: string
  raw: Record<string, unknown>
}

export async function readContainerStats(): Promise<DockerStatsRow[]> {
  const result = await runProcess('docker', ['stats', '--no-stream', '--format', '{{json .}}'], {
    reject: false,
    timeout: 20_000,
  })
  if (result.exitCode !== 0 || result.stdout.trim() === '') return []
  const rows: DockerStatsRow[] = []
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const id = typeof parsed.ID === 'string' ? parsed.ID : ''
      const name = typeof parsed.Name === 'string' ? parsed.Name : ''
      if (id === '' && name === '') continue
      rows.push({ id, name, raw: parsed })
    } catch {
      // one malformed line must not drop the rest
    }
  }
  return rows
}

export async function inspectContainers(all = true): Promise<ContainerRecord[]> {
  await requireDocker()
  const listed = await runProcess('docker', ['ps', all ? '-aq' : '-q'])
  const ids = listed.stdout.split(/\s+/).filter(Boolean)
  if (ids.length === 0) return []
  const result = await runProcess('docker', ['inspect', ...ids])
  const parsed = z.array(InspectSchema).parse(JSON.parse(result.stdout))
  return parsed.map((item) => {
    const ports: ContainerRecord['ports'] = []
    for (const [privateSpec, bindings] of Object.entries(item.NetworkSettings.Ports ?? {})) {
      const [privateText, type = 'tcp'] = privateSpec.split('/')
      if (!bindings?.length) ports.push({ ip: '', privatePort: Number(privateText), publicPort: null, type })
      else
        for (const binding of bindings)
          ports.push({
            ip: binding.HostIp ?? '',
            privatePort: Number(privateText),
            publicPort: binding.HostPort ? Number(binding.HostPort) : null,
            type,
          })
    }
    return {
      id: item.Id,
      name: item.Name.replace(/^\//, ''),
      image: item.Config.Image,
      state: item.State.Status,
      labels: item.Config.Labels ?? {},
      ports,
      networks: Object.keys(item.NetworkSettings.Networks ?? {}).sort(),
      health: item.State.Health?.Status ?? null,
      networkMode: item.HostConfig?.NetworkMode,
      mounts: (item.Mounts ?? []).map((mount) => ({ source: mount.Source ?? '', readWrite: mount.RW ?? false })),
    }
  })
}

export async function networkExists(name: string): Promise<boolean> {
  const result = await runProcess('docker', ['network', 'inspect', identifier(name, 'network name')], { reject: false })
  return result.exitCode === 0
}

export async function ensureNetwork(name: string): Promise<'ok' | 'created'> {
  if (await networkExists(name)) return 'ok'
  await runProcess('docker', [
    'network',
    'create',
    '--label',
    'portta.managed=true',
    '--label',
    'portta.component=shared-network',
    identifier(name, 'network name'),
  ])
  return 'created'
}

export async function isManagedContainer(id: string): Promise<boolean> {
  const result = await runProcess(
    'docker',
    ['inspect', identifier(id), '--format', '{{ index .Config.Labels "portta.managed" }}'],
    { reject: false },
  )
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}
