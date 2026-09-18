// The consolidated Service: what an environment runs, its endpoints and its
// resource usage as one row a person or an agent can act on.

import { z } from 'portta-core/zod'
import {
  Bridge,
  ContainerState,
  EndpointScope,
  Health,
  PublishedPort,
  ServiceKind,
  ServiceOverrides,
  ServiceTech,
} from './types.ts'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const ServiceAccessEndpoint = named(
  z
    .object({
      provider: z.string(),
      url: z.string().describe('An http(s) URL, or host:port for a datastore'),
      scope: EndpointScope,
      usable: z.boolean(),
      shareable: z.boolean(),
      problem: z.string().nullable(),
    })
    .strict(),
  'ServiceAccessEndpoint',
)
export type ServiceAccessEndpoint = z.infer<typeof ServiceAccessEndpoint>

export const ServiceAccess = named(
  z
    .object({
      kind: z.enum(['http', 'tcp', 'none']).describe('How this service is reached'),
      primary: ServiceAccessEndpoint.nullable().describe('The one address to open first'),
      endpoints: z.array(ServiceAccessEndpoint),
      bridge: Bridge.nullable().describe('An open loopback bridge, for a datastore'),
      routed: z.boolean().describe('Whether the service opted into the gateway'),
      problem: z.string().nullable().describe('Why it cannot be reached, when it cannot'),
    })
    .strict(),
  'ServiceAccess',
)
export type ServiceAccess = z.infer<typeof ServiceAccess>

export const ServiceResources = named(
  z
    .object({
      cpuUtilisation: z.number().nullable(),
      memoryUsedBytes: z.number().nullable(),
      memoryLimitBytes: z.number().nullable(),
      diskBytes: z.number().nullable().describe('Null: the collector has no per-container disk yet'),
      collectedAt: unixSeconds.nullable(),
      stale: z.boolean(),
    })
    .strict(),
  'ServiceResources',
)
export type ServiceResources = z.infer<typeof ServiceResources>

export const ServiceActions = named(
  z
    .object({
      start: z.boolean(),
      stop: z.boolean(),
      restart: z.boolean(),
      logs: z.boolean(),
      openAccess: z.boolean().describe('A loopback bridge can be opened'),
      share: z.boolean().describe('A temporary hostname can be created'),
    })
    .strict(),
  'ServiceActions',
)
export type ServiceActions = z.infer<typeof ServiceActions>

export const Service = named(
  z
    .object({
      name: z.string().describe('Compose service name'),
      environment: z.string().describe('COMPOSE_PROJECT_NAME'),
      containerId: z.string(),
      containerName: z.string(),
      image: z.string(),
      kind: ServiceKind,
      tech: ServiceTech,
      state: ContainerState,
      health: Health,
      startedAt: unixSeconds.nullable(),
      uptimeSeconds: z.number().nullable(),
      restartCount: z.number().int(),
      exitCode: z.number().int().nullable(),
      completed: z.boolean().optional().describe('Exited 0 with no restart policy: a one-shot that did its job'),
      ports: z.array(PublishedPort),
      exposedPorts: z.array(z.number().int()),
      networks: z.array(z.string()),
      onGatewayNetwork: z.boolean(),
      access: ServiceAccess,
      resources: ServiceResources.nullable(),
      actions: ServiceActions,
      overrides: ServiceOverrides.optional(),
      hidden: z.boolean().describe('Collapsed by an environment override'),
    })
    .strict(),
  'Service',
)
export type Service = z.infer<typeof Service>

export const EnvironmentServices = named(
  z
    .object({
      environment: z.string(),
      services: z.array(Service),
      resources: ServiceResources.nullable().describe('The environment as a whole'),
    })
    .strict(),
  'EnvironmentServices',
)
export type EnvironmentServices = z.infer<typeof EnvironmentServices>
