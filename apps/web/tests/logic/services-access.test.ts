import type { ContainerSummary } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { accessFromContainer, serviceFromContainer } from '@/lib/services'

const mailpit = {
  id: 'mail',
  name: 'alpha-mailpit-1',
  environment: 'alpha',
  service: 'mailpit',
  image: 'axllent/mailpit:latest',
  kind: 'smtp',
  state: 'running',
  onGatewayNetwork: true,
  traefikEnabled: false,
  exposedPorts: [1025, 8025],
  containerPorts: [
    { port: 1025, protocol: 'tcp' },
    { port: 8025, protocol: 'tcp' },
  ],
  ports: [],
  labels: {},
  urls: [
    {
      host: 'alpha--mailpit.example.test',
      url: 'https://alpha--mailpit.example.test',
      scheme: 'https',
      scope: 'public',
      alias: true,
      targetPort: 8025,
    },
  ],
} as unknown as ContainerSummary

describe('fallback service access', () => {
  it('opens the web panel on a mixed service and keeps its TCP access action', () => {
    expect(accessFromContainer(mailpit)).toMatchObject({
      kind: 'http',
      routed: true,
      primary: { url: 'https://alpha--mailpit.example.test' },
    })
    expect(serviceFromContainer(mailpit)).toMatchObject({ kind: 'smtp', actions: { openAccess: true, share: false } })
  })

  it('does not advertise the old web address while the service is stopped', () => {
    expect(accessFromContainer({ ...mailpit, state: 'exited' })).toMatchObject({
      kind: 'http',
      primary: null,
      endpoints: [],
    })
  })

  it('does not offer a managed address as usable when its container left the gateway network', () => {
    expect(accessFromContainer({ ...mailpit, onGatewayNetwork: false })).toMatchObject({
      primary: null,
      routed: false,
      problem: 'off-network',
      endpoints: [{ usable: false }],
    })
  })
})
