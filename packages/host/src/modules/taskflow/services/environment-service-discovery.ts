import type {
  DiscoveryEvidence,
  Endpoint,
  EnvironmentRecord,
  EnvironmentService,
  ServiceKind,
  ServicePort,
  ServiceStatus,
} from 'portta-core/taskflow'
import { z } from 'zod'
import { NodeProcessRunner, type ProcessRunner, runCaptured } from '../adapters/process-runner.ts'

const bindingSchema = z.object({ HostIp: z.string(), HostPort: z.string() })
const inspectionSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Config: z.object({
    Labels: z.record(z.string(), z.string()).nullable().optional(),
    ExposedPorts: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  State: z.object({
    Status: z.string(),
    Health: z.object({ Status: z.string() }).optional(),
  }),
  NetworkSettings: z.object({
    Ports: z.record(z.string(), z.array(bindingSchema).nullable()).nullable().optional(),
  }),
})

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? z.record(z.string(), z.unknown()).parse(value)
    : {}
}

function serviceId(environmentId: string, name: string): string {
  return `service_${environmentId}_${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function protocolFor(port: number, attributes: Record<string, unknown>): ServicePort['protocol'] {
  const configured = object(attributes[String(port)]).protocol
  if (configured === 'http' || configured === 'https') return configured
  if (port === 80 || port === 3000 || port === 5173 || port === 8000 || port === 8080) return 'http'
  return 'tcp'
}

function kindFor(port: ServicePort): ServiceKind {
  if (port.protocol === 'http' || port.protocol === 'https') return 'http'
  if (port.containerPort === 5432 || port.containerPort === 3306) return 'database'
  if (port.containerPort === 6379 || port.containerPort === 11211) return 'cache'
  return 'tcp'
}

function statusFor(state: z.infer<typeof inspectionSchema>['State']): ServiceStatus {
  if (state.Status !== 'running') return 'stopped'
  if (state.Health?.Status === 'unhealthy') return 'unhealthy'
  return state.Health?.Status === 'starting' ? 'starting' : 'running'
}

function parsePort(key: string): { port: number; transport: 'tcp' | 'udp' } | null {
  const match = /^(\d+)\/(tcp|udp)$/.exec(key)
  if (!match) return null
  const port = Number(match[1])
  const transport = match[2]
  return Number.isInteger(port) && port > 0 && port <= 65535 && (transport === 'tcp' || transport === 'udp')
    ? { port, transport }
    : null
}

function hintedPorts(configuration: Record<string, unknown>, serviceName: string, primary: boolean): number[] {
  const values = Array.isArray(configuration.forwardPorts) ? configuration.forwardPorts : []
  return values.flatMap((value) => {
    if (typeof value === 'number' && primary) return [value]
    if (typeof value !== 'string') return []
    const match = /^(?:(.+):)?(\d+)$/.exec(value)
    if (!match || (match[1] ? match[1] !== serviceName : !primary)) return []
    const port = Number(match[2])
    return Number.isInteger(port) && port > 0 && port <= 65535 ? [port] : []
  })
}

function endpointsFor(environmentId: string, name: string, primary: boolean, port: ServicePort): Endpoint[] {
  const id = serviceId(environmentId, name)
  const scheme = port.protocol === 'https' ? 'https' : port.protocol === 'http' ? 'http' : 'tcp'
  const internalHost = primary ? '127.0.0.1' : name
  const endpoints: Endpoint[] = [
    {
      id: `endpoint_${id}_internal_${port.containerPort}`,
      serviceId: id,
      url: `${scheme}://${internalHost}:${port.containerPort}`,
      audiences: ['agent'],
      visibility: 'environment',
      accessMode: 'internal',
      executionLocus: 'environment',
      stable: true,
      provider: 'environment-network',
    },
  ]
  if (port.hostBinding) {
    endpoints.push({
      id: `endpoint_${id}_host_${port.hostBinding.port}`,
      serviceId: id,
      url: `${scheme}://${port.hostBinding.host}:${port.hostBinding.port}`,
      audiences: ['taskflow', 'user'],
      visibility: 'private',
      accessMode: 'localhost',
      executionLocus: 'host',
      stable: false,
      provider: 'docker-publish',
    })
  }
  return endpoints
}

export class DockerServiceDiscoverySource {
  private readonly runner: ProcessRunner
  constructor(runner: ProcessRunner = new NodeProcessRunner()) {
    this.runner = runner
  }

  async discover(environment: EnvironmentRecord): Promise<EnvironmentService[]> {
    if (environment.provider === 'host') return []
    const composeProject = environment.providerRef.value.composeProjectName
    const primaryRef = environment.providerRef.value.containerId ?? environment.providerRef.value.containerName
    if (typeof primaryRef !== 'string' || !primaryRef) return []
    let ids = [primaryRef]
    if (typeof composeProject === 'string' && composeProject) {
      const listed = await runCaptured(this.runner, {
        command: 'docker',
        args: ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${composeProject}`],
      })
      if (listed.exit.code === 0) ids = listed.stdout.split(/\s+/).filter(Boolean)
    }
    if (ids.length === 0) return []
    const inspected = await runCaptured(this.runner, { command: 'docker', args: ['inspect', ...ids] })
    if (inspected.exit.code !== 0) throw new Error(inspected.stderr.trim())
    const containers = z.array(inspectionSchema).parse(JSON.parse(inspected.stdout))
    const configuration = object(
      environment.providerRef.value.mergedConfiguration ?? environment.providerRef.value.configuration,
    )
    const attributes = object(configuration.portsAttributes)
    return containers.map((container) => {
      const labels = container.Config.Labels ?? {}
      const name = labels['com.docker.compose.service'] ?? container.Name.replace(/^\//, '')
      const primary = container.Id === primaryRef || container.Id.startsWith(primaryRef) || name === primaryRef
      const rawPorts = new Set([
        ...Object.keys(container.Config.ExposedPorts ?? {}),
        ...Object.keys(container.NetworkSettings.Ports ?? {}),
      ])
      for (const port of hintedPorts(configuration, name, primary)) rawPorts.add(`${port}/tcp`)
      const ports = [...rawPorts].flatMap((key): ServicePort[] => {
        const parsed = parsePort(key)
        if (!parsed) return []
        const binding = container.NetworkSettings.Ports?.[key]?.[0]
        const protocol = parsed.transport === 'udp' ? 'udp' : protocolFor(parsed.port, attributes)
        return [
          {
            containerPort: parsed.port,
            protocol,
            ...(binding
              ? {
                  hostBinding: {
                    host: binding.HostIp === '0.0.0.0' ? '127.0.0.1' : binding.HostIp,
                    port: Number(binding.HostPort),
                  },
                }
              : {}),
            ...(typeof object(attributes[String(parsed.port)]).label === 'string'
              ? { label: String(object(attributes[String(parsed.port)]).label) }
              : {}),
          },
        ]
      })
      const provenance: DiscoveryEvidence[] = [
        { source: 'docker', detail: `container ${container.Id}`, confidence: 'observed' },
      ]
      if (labels['com.docker.compose.service'])
        provenance.push({ source: 'compose', detail: `service ${name}`, confidence: 'explicit' })
      if (hintedPorts(configuration, name, primary).length > 0)
        provenance.push({ source: 'devcontainer', detail: 'forwardPorts', confidence: 'explicit' })
      return {
        id: serviceId(environment.id, name),
        environmentId: environment.id,
        name,
        status: statusFor(container.State),
        kind: ports[0] ? kindFor(ports[0]) : 'unknown',
        containerIds: [container.Id],
        ports,
        endpoints: ports.flatMap((port) => endpointsFor(environment.id, name, primary, port)),
        provenance,
      }
    })
  }
}

export function mergeEnvironmentServices(sources: EnvironmentService[][]): EnvironmentService[] {
  const merged = new Map<string, EnvironmentService>()
  for (const services of sources) {
    for (const service of services) {
      const existing = merged.get(service.name)
      if (!existing) {
        merged.set(service.name, service)
        continue
      }
      const ports = new Map(existing.ports.map((port) => [`${port.containerPort}/${port.protocol}`, port]))
      for (const port of service.ports) ports.set(`${port.containerPort}/${port.protocol}`, port)
      const endpoints = new Map(existing.endpoints.map((endpoint) => [endpoint.id, endpoint]))
      for (const endpoint of service.endpoints) endpoints.set(endpoint.id, endpoint)
      const provenance = new Map(
        [...existing.provenance, ...service.provenance].map((evidence) => [
          `${evidence.source}:${evidence.confidence}:${evidence.detail}`,
          evidence,
        ]),
      )
      merged.set(service.name, {
        ...existing,
        status: service.status === 'unknown' ? existing.status : service.status,
        kind: service.kind === 'unknown' ? existing.kind : service.kind,
        containerIds: [...new Set([...existing.containerIds, ...service.containerIds])],
        ports: [...ports.values()],
        endpoints: [...endpoints.values()],
        provenance: [...provenance.values()],
      })
    }
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
}
