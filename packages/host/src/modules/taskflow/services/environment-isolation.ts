import { z } from 'zod'

export type IsolationRiskKind =
  | 'fixed_host_port'
  | 'container_name'
  | 'external_resource'
  | 'host_network'
  | 'bind_mount'
  | 'docker_socket'
  | 'device'
  | 'privileged'
  | 'capability'
  | 'security_option'
  | 'secret'

export interface IsolationRisk {
  kind: IsolationRiskKind
  resource: string
  detail: string
}

export interface IsolationReport {
  isolated: boolean
  risks: IsolationRisk[]
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? z.record(z.string(), z.unknown()).parse(value)
    : {}
}

function externalResources(root: Record<string, unknown>, key: 'networks' | 'volumes'): IsolationRisk[] {
  return Object.entries(object(root[key])).flatMap(([name, value]) =>
    object(value).external === true
      ? [{ kind: 'external_resource' as const, resource: `${key}.${name}`, detail: 'resource lifecycle is external' }]
      : [],
  )
}

export function buildIsolationReport(compose: unknown): IsolationReport {
  const root = object(compose)
  const risks: IsolationRisk[] = [...externalResources(root, 'networks'), ...externalResources(root, 'volumes')]
  for (const [name, rawService] of Object.entries(object(root.services))) {
    const service = object(rawService)
    if (typeof service.container_name === 'string') {
      risks.push({ kind: 'container_name', resource: name, detail: service.container_name })
    }
    if (service.network_mode === 'host')
      risks.push({ kind: 'host_network', resource: name, detail: 'network_mode: host' })
    if (service.privileged === true) risks.push({ kind: 'privileged', resource: name, detail: 'privileged: true' })
    for (const capability of Array.isArray(service.cap_add) ? service.cap_add : []) {
      risks.push({ kind: 'capability', resource: name, detail: String(capability) })
    }
    for (const option of Array.isArray(service.security_opt) ? service.security_opt : []) {
      risks.push({ kind: 'security_option', resource: name, detail: String(option) })
    }
    for (const secret of Array.isArray(service.secrets) ? service.secrets : []) {
      risks.push({
        kind: 'secret',
        resource: name,
        detail: typeof secret === 'string' ? secret : JSON.stringify(secret),
      })
    }
    for (const port of Array.isArray(service.ports) ? service.ports : []) {
      const definition = object(port)
      const text = typeof port === 'string' || typeof port === 'number' ? String(port) : JSON.stringify(port)
      const published = Number(definition.published)
      if (/^(?:127\.0\.0\.1:|0\.0\.0\.0:|\[::\]:)?\d+:\d+/.test(text) || published > 0) {
        risks.push({ kind: 'fixed_host_port', resource: name, detail: text })
      }
    }
    for (const mount of Array.isArray(service.volumes) ? service.volumes : []) {
      const definition = object(mount)
      const text = typeof mount === 'string' ? mount : JSON.stringify(mount)
      if (text.includes('/var/run/docker.sock')) risks.push({ kind: 'docker_socket', resource: name, detail: text })
      else if (
        definition.type === 'bind' ||
        text.startsWith('/') ||
        text.startsWith('~') ||
        text.includes('type=bind')
      ) {
        risks.push({ kind: 'bind_mount', resource: name, detail: text })
      }
    }
    for (const device of Array.isArray(service.devices) ? service.devices : []) {
      risks.push({ kind: 'device', resource: name, detail: String(device) })
    }
  }
  return { isolated: risks.every((risk) => risk.kind === 'external_resource'), risks }
}
