import { z } from 'portta-core/zod'

export const HttpIntegrationResult = z
  .object({ ready: z.boolean(), requestId: z.string().uuid().nullable() })
  .strict()
  .meta({ ref: 'HttpIntegrationResult' })
export type HttpIntegrationResult = z.infer<typeof HttpIntegrationResult>

export const HttpIntegrationOperation = z
  .object({
    requestId: z.string().uuid(),
    project: z.string(),
    service: z.string(),
    port: z.number().int().min(1).max(65535),
    state: z.enum(['pending', 'running', 'ok', 'failed']),
    error: z.string().nullable(),
  })
  .strict()
  .meta({ ref: 'HttpIntegrationOperation' })
export type HttpIntegrationOperation = z.infer<typeof HttpIntegrationOperation>
