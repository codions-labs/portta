// The Overview, assembled from pieces the routes already have.
//
// Pure over its inputs: the route reads the catalog, the metrics and the
// diagnostics, and this decides what deserves attention and how a project is
// summarised. Tested without a database.

import type {
  AttentionItem,
  DevelopmentOverview,
  Diagnostic,
  Environment,
  MetricsCurrent,
  Project,
  ProjectPulse,
} from 'portta-contracts'
import { hostPressure, type PressureReason } from 'portta-core'

export interface OverviewInput {
  now: number
  projects: Project[]
  environments: Environment[]
  metrics: MetricsCurrent
  problems: Diagnostic[]
  gatewayUp: boolean
}

// A service that exited 0 with no restart policy (a migration, an init job)
// did what it was for. It is not running, and the environment is not degraded
// because of it. Same rule as environmentHealth in the UI.
function degraded(env: Pick<Environment, 'serviceCount' | 'runningCount' | 'completedCount'>): boolean {
  return env.runningCount > 0 && env.runningCount + (env.completedCount ?? 0) < env.serviceCount
}

function environmentHealth(env: Environment): 'ok' | 'partial' | 'unhealthy' | 'idle' {
  if (env.runningCount === 0) return 'idle'
  if (env.unhealthyCount > 0) return 'unhealthy'
  if (degraded(env)) return 'partial'
  return 'ok'
}

function worst(a: ProjectPulse['health'], b: ProjectPulse['health']): ProjectPulse['health'] {
  const rank = { unhealthy: 3, partial: 2, ok: 1, idle: 0 }
  return rank[a] >= rank[b] ? a : b
}

/** A reason as an operator would read it: the resource, and the number behind it. */
function readingOf(reason: PressureReason): string {
  const label = reason.resource === 'memory' ? 'RAM' : reason.resource === 'storage' ? 'disk' : reason.resource
  if (reason.resource === 'temperature') return `${label} ${Math.round(reason.value)}°C`
  if (reason.resource === 'load') return `${label} ${reason.value.toFixed(1)} per core`
  return `${label} ${Math.round(reason.value * 100)}%`
}

export function attentionFor(input: OverviewInput): AttentionItem[] {
  const items: AttentionItem[] = []
  const slugOf = new Map<string, string>()
  for (const project of input.projects)
    for (const env of project.environments) slugOf.set(env.environment, project.slug)

  for (const env of input.environments) {
    for (const service of env.services) {
      if (service.state === 'running' && service.health === 'unhealthy') {
        items.push({
          kind: 'service-unhealthy',
          severity: 'fail',
          summary: `${env.name}/${service.service ?? service.name} is unhealthy`,
          project: slugOf.get(env.name) ?? null,
          environment: env.name,
          service: service.service ?? service.name,
          href: `#/environments/${encodeURIComponent(env.name)}?service=${encodeURIComponent(service.service ?? service.name)}`,
        })
      }
    }
    if (degraded(env)) {
      items.push({
        kind: 'environment-degraded',
        severity: 'warn',
        summary: `${env.name}: ${env.runningCount} of ${env.serviceCount} services running`,
        project: slugOf.get(env.name) ?? null,
        environment: env.name,
        service: null,
        href: `#/environments/${encodeURIComponent(env.name)}`,
      })
    }
  }

  // Every ratio in the metrics is 0-1, so the thresholds are too; comparing
  // them against percentages is what kept this item from ever appearing.
  const pressure = hostPressure(input.metrics.host, {
    stale: input.metrics.stale,
    collectorActive: input.metrics.collectorActive,
  })
  if (pressure.level !== 'normal') {
    items.push({
      kind: 'host-pressure',
      severity: pressure.level === 'critical' ? 'fail' : 'warn',
      summary: `this host is under pressure: ${pressure.reasons.map(readingOf).join(', ')}`,
      project: null,
      environment: null,
      service: null,
      href: '#/overview',
    })
  }

  for (const problem of input.problems) {
    if (problem.status === 'fail') {
      items.push({
        kind: 'diagnostic',
        severity: 'fail',
        summary: problem.title,
        project: null,
        environment: null,
        service: null,
        href: '#/gateway',
      })
    }
  }

  const rank = { fail: 0, warn: 1 }
  return items.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export function projectPulses(input: OverviewInput): ProjectPulse[] {
  const byEnvironment = new Map(input.environments.map((env) => [env.name, env]))
  const metricsByEnvironment = new Map(input.metrics.projects.map((p) => [p.composeProject, p]))
  return input.projects
    .map((project) => {
      const envs = project.environments
        .map((link) => byEnvironment.get(link.environment))
        .filter((env): env is Environment => env !== undefined)
      let health: ProjectPulse['health'] = 'idle'
      for (const env of envs) health = worst(health, environmentHealth(env))
      let cpu: number | null = null
      let memory: number | null = null
      for (const env of envs) {
        const measured = metricsByEnvironment.get(env.name)
        if (!measured) continue
        if (measured.cpuUtilisation !== null) cpu = (cpu ?? 0) + measured.cpuUtilisation
        if (measured.memoryUsedBytes !== null) memory = (memory ?? 0) + measured.memoryUsedBytes
      }
      return {
        slug: project.slug,
        name: project.name,
        archived: project.archived,
        environmentCount: envs.length,
        runningEnvironments: envs.filter((env) => env.runningCount > 0).length,
        unhealthyServices: envs.reduce((sum, env) => sum + env.unhealthyCount, 0),
        health,
        resources: cpu === null && memory === null ? null : { cpuUtilisation: cpu, memoryUsedBytes: memory },
      }
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
}

export function buildOverview(input: OverviewInput): DevelopmentOverview {
  const slugOf = new Map<string, { slug: string; name: string }>()
  for (const project of input.projects)
    for (const env of project.environments) slugOf.set(env.environment, { slug: project.slug, name: project.name })
  const host = input.metrics.host
  return {
    generatedAt: Math.floor(input.now / 1000),
    attention: attentionFor(input),
    projects: projectPulses(input),
    runtime: {
      environmentsRunning: input.environments.filter((env) => env.runningCount > 0).length,
      environmentsTotal: input.environments.length,
      servicesRunning: input.environments.reduce((sum, env) => sum + env.runningCount, 0),
      servicesUnhealthy: input.environments.reduce((sum, env) => sum + env.unhealthyCount, 0),
      routedUrls: input.environments.reduce((sum, env) => sum + env.urls.length, 0),
    },
    resources: {
      host: host
        ? {
            cpuUtilisation: host.cpuUtilisation ?? null,
            memoryUsedPercent: host.memoryUsedPercent ?? null,
            storageUsedPercent: host.storage?.usedPercent ?? null,
            stale: input.metrics.stale,
            collectorActive: input.metrics.collectorActive,
            pressure: hostPressure(host, {
              stale: input.metrics.stale,
              collectorActive: input.metrics.collectorActive,
            }),
          }
        : null,
      topProjects: [...input.metrics.projects]
        .sort((a, b) => (b.memoryUsedBytes ?? 0) - (a.memoryUsedBytes ?? 0))
        .slice(0, 5)
        .map((measured) => ({
          slug: slugOf.get(measured.composeProject)?.slug ?? null,
          name: slugOf.get(measured.composeProject)?.name ?? measured.name,
          environment: measured.composeProject,
          cpuUtilisation: measured.cpuUtilisation,
          memoryUsedBytes: measured.memoryUsedBytes,
        })),
    },
    gateway: { up: input.gatewayUp, problems: input.problems },
  }
}
