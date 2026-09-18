import { Hono } from 'hono'
import { EnvironmentReport, MetricsCurrent, MetricsHistory, SecurityReport } from 'portta-contracts'
import type { AppDeps } from '../../deps.ts'
import { readEnvironmentReport } from '../../services/environment.ts'
import { readHostSecurityReport } from '../../services/host-security.ts'
import { historyWindowSeconds, readCurrentMetrics, readMetricsHistory } from '../../services/metrics.ts'
import { documentRoute } from '../openapi.ts'

export function hostRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get(
    '/environment',
    documentRoute({
      tag: 'Status',
      operationId: 'getEnvironmentReport',
      permission: 'metrics:read',
      summary: 'Get the latest host environment readiness report',
      response: EnvironmentReport,
      description:
        'Reads state/environment/report.json written by the host CLI. A missing or invalid file means never collected, not a server error.',
      errors: [500],
    }),
    (c) => c.json(readEnvironmentReport(deps.config)),
  )

  app.get(
    '/environment/security',
    documentRoute({
      tag: 'Status',
      operationId: 'getHostSecurityReport',
      permission: 'metrics:read',
      summary: 'Get the latest read-only host security observations',
      response: SecurityReport,
      description:
        'Reads state/environment/security.json. Probes never use sudo and never change SSH, firewall, services, users or ports.',
      errors: [500],
    }),
    (c) => c.json(readHostSecurityReport(deps.config)),
  )

  app.get(
    '/metrics/current',
    documentRoute({
      tag: 'Status',
      operationId: 'getMetricsCurrent',
      permission: 'metrics:read',
      summary: 'Get the latest host and project metrics snapshot',
      response: MetricsCurrent,
      description:
        'Reads state/metrics/current.json written by the CLI collector. The panel never collects. A missing file is an empty object, never an error.',
      errors: [500],
    }),
    (c) => c.json(readCurrentMetrics(deps.config)),
  )

  app.get(
    '/metrics/history',
    documentRoute({
      tag: 'Status',
      operationId: 'getMetricsHistory',
      permission: 'metrics:read',
      summary: 'Get the short host metrics history',
      response: MetricsHistory,
      description: 'Reads state/metrics/history.jsonl. window is 15m, 30m or 60m.',
      errors: [500],
      parameters: [
        {
          name: 'window',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['15m', '30m', '60m'] },
        },
      ],
    }),
    (c) => {
      const windowSeconds = historyWindowSeconds(c.req.query('window'))
      return c.json(readMetricsHistory(deps.config, windowSeconds))
    },
  )

  return app
}
