// The Overview: what is running, what is wrong and what it costs. A read model
// over the entities in types.ts and service-types.ts.

import { z } from 'portta-core/zod'
import { Diagnostic } from './types.ts'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

/**
 * The host's state in one word, and the readings behind it. Computed from the
 * metrics the collector already writes; `measured: false` means the collector
 * is off or the snapshot is old, and the level says nothing.
 */
export const HostPressure = named(
  z
    .object({
      level: z.enum(['normal', 'watch', 'pressured', 'critical']),
      measured: z.boolean(),
      reasons: z.array(
        z
          .object({
            resource: z.enum(['cpu', 'memory', 'swap', 'storage', 'gpu', 'temperature', 'load', 'battery']),
            level: z.enum(['watch', 'pressured', 'critical']),
            value: z.number().describe('A ratio for anything measured 0-1, else the raw reading'),
          })
          .strict(),
      ),
    })
    .strict(),
  'HostPressure',
)
export type HostPressure = z.infer<typeof HostPressure>

export const AttentionItem = named(
  z
    .object({
      kind: z.enum(['service-unhealthy', 'environment-degraded', 'diagnostic', 'host-pressure']),
      severity: z.enum(['warn', 'fail']),
      summary: z.string(),
      project: z.string().nullable().describe('Project slug'),
      environment: z.string().nullable(),
      service: z.string().nullable(),
      href: z.string().describe('Where in the panel to act on it'),
    })
    .strict(),
  'AttentionItem',
)
export type AttentionItem = z.infer<typeof AttentionItem>

export const ProjectPulse = named(
  z
    .object({
      slug: z.string(),
      name: z.string(),
      archived: z.boolean(),
      environmentCount: z.number().int(),
      runningEnvironments: z.number().int(),
      unhealthyServices: z.number().int(),
      health: z.enum(['ok', 'partial', 'unhealthy', 'idle']),
      resources: z
        .object({ cpuUtilisation: z.number().nullable(), memoryUsedBytes: z.number().nullable() })
        .strict()
        .nullable(),
    })
    .strict(),
  'ProjectPulse',
)
export type ProjectPulse = z.infer<typeof ProjectPulse>

export const DevelopmentOverview = named(
  z
    .object({
      generatedAt: unixSeconds,
      attention: z.array(AttentionItem),
      projects: z.array(ProjectPulse),
      runtime: z
        .object({
          environmentsRunning: z.number().int(),
          environmentsTotal: z.number().int(),
          servicesRunning: z.number().int(),
          servicesUnhealthy: z.number().int(),
          routedUrls: z.number().int(),
        })
        .strict(),
      resources: z
        .object({
          host: z
            .object({
              cpuUtilisation: z.number().nullable(),
              memoryUsedPercent: z.number().nullable(),
              storageUsedPercent: z.number().nullable(),
              stale: z.boolean(),
              collectorActive: z.boolean(),
              pressure: HostPressure,
            })
            .strict()
            .nullable(),
          topProjects: z.array(
            z
              .object({
                slug: z.string().nullable(),
                name: z.string(),
                environment: z.string(),
                cpuUtilisation: z.number().nullable(),
                memoryUsedBytes: z.number().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
      gateway: z.object({ up: z.boolean(), problems: z.array(Diagnostic) }).strict(),
    })
    .strict(),
  'DevelopmentOverview',
)
export type DevelopmentOverview = z.infer<typeof DevelopmentOverview>

export const EnvironmentResources = named(
  z
    .object({
      environment: z.string(),
      project: z.string().nullable().describe('Project slug, when adopted'),
      cpuUtilisation: z.number().nullable(),
      memoryUsedBytes: z.number().nullable(),
      containerCount: z.number().int(),
      containers: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            service: z.string().nullable(),
            cpuUtilisation: z.number().nullable(),
            memoryUsedBytes: z.number().nullable(),
            memoryLimitBytes: z.number().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
  'EnvironmentResources',
)
export type EnvironmentResources = z.infer<typeof EnvironmentResources>

/** Host → Project → Environment → Service → Container, attributed through adoption. */
export const ProjectResources = named(
  z
    .object({
      project: z.string(),
      collectedAt: unixSeconds.nullable(),
      stale: z.boolean(),
      collectorActive: z.boolean(),
      cpuUtilisation: z.number().nullable(),
      memoryUsedBytes: z.number().nullable(),
      hostMemoryTotalBytes: z.number().nullable(),
      environments: z.array(EnvironmentResources),
    })
    .strict(),
  'ProjectResources',
)
export type ProjectResources = z.infer<typeof ProjectResources>
