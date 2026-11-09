import { describe, expect, it } from 'vitest'
import { HttpIntegrationOperation, HttpIntegrationResult } from './http-access-types.ts'
import { ContainerPort, RouteUrl } from './types.ts'

describe('HTTP access contracts', () => {
  it('keeps aliases without new metadata compatible and bounds target ports', () => {
    const oldUrl = { url: 'http://mail.localhost', host: 'mail.localhost', scope: 'local', scheme: 'http' }
    expect(RouteUrl.parse(oldUrl)).toEqual(oldUrl)
    expect(RouteUrl.safeParse({ ...oldUrl, targetPort: 65536 }).success).toBe(false)
    expect(ContainerPort.parse({ port: 8025, protocol: 'tcp' })).toEqual({ port: 8025, protocol: 'tcp' })
  })

  it('correlates operation results without accepting credentials', () => {
    const operation = {
      requestId: '1ba200d8-63f2-4b53-934c-1a68ce45590c',
      project: 'shop',
      service: 'mailpit',
      port: 8025,
      state: 'running',
      error: null,
    }
    expect(HttpIntegrationOperation.parse(operation)).toEqual(operation)
    expect(HttpIntegrationOperation.safeParse({ ...operation, password: 'not-persisted' }).success).toBe(false)
    expect(HttpIntegrationResult.parse({ ready: true, requestId: null })).toEqual({ ready: true, requestId: null })
  })
})
