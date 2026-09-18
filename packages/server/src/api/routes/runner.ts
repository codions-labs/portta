import { Hono } from 'hono'
import { RunnerStatus } from 'portta-contracts'
import type { AppDeps } from '../../deps.ts'
import { runnerStatus } from '../../services/runner.ts'
import { documentRoute } from '../openapi.ts'

export function runnerRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get(
    '/runner',
    documentRoute({
      tag: 'Environments',
      operationId: 'getRunnerStatus',
      permission: 'environment:read',
      summary: 'Get the project-runner state',
      response: RunnerStatus,
      description:
        'Reads the prepared runner container back. A host that has not opted in gets a reason, never an error.',
      parameters: [
        {
          name: 'logs',
          in: 'query',
          required: false,
          description: "Include the tail of the runner's output. A failed run always includes it.",
          schema: { type: 'string', enum: ['0', '1'], default: '0' },
        },
      ],
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      return c.json(await runnerStatus(deps.client, snapshot, deps.config, { logs: c.req.query('logs') === '1' }))
    },
  )

  return app
}
