import { Hono } from 'hono'
import { NetworkView } from 'portta-contracts'
import { schemeFor } from '../../config.ts'
import type { AppDeps } from '../../deps.ts'
import { componentOf, gatewayStatus } from '../../services/gateway.ts'
import { documentRoute } from '../openapi.ts'

export function networkRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Domains, routes, networks, Tailscale and DNS in one place. Everything is
  // read from Docker labels and the resolved configuration, so it matches what
  // Traefik is actually serving.
  app.get(
    '/network',
    documentRoute({
      tag: 'Network',
      operationId: 'getNetwork',
      permission: 'gateway:read',
      summary: 'Get routes, networks, DNS, TLS and VPN state',
      response: NetworkView,
      errors: [500, 502],
    }),
    async (c) => {
      const snapshot = await deps.cache.get()
      const tailscale = componentOf(snapshot, 'tailscale')

      const view: NetworkView = {
        gateway: gatewayStatus(snapshot, deps.config),
        domains: {
          local: deps.config.domain,
          private: deps.config.privateDomain,
          public: deps.config.publicDomain,
          scheme: schemeFor(deps.config),
        },
        routes: snapshot.containers
          .filter((container) => container.ownership !== 'gateway' && container.urls.length > 0)
          .map((container) => ({
            project: container.environment,
            service: container.service,
            containerId: container.id,
            containerName: container.name,
            state: container.state,
            urls: container.urls,
            port:
              Object.entries(container.labels).find(
                ([key]) => key.startsWith('traefik.http.services.') && key.endsWith('.loadbalancer.server.port'),
              )?.[1] ?? 'auto',
          }))
          .sort((a, b) => (a.project ?? '').localeCompare(b.project ?? '')),
        networks: snapshot.networks,
        tailscale: {
          enabled: deps.config.tailscaleEnabled,
          running: tailscale?.state === 'running',
          hostname: deps.config.tailscaleHostname,
          state: tailscale?.state ?? 'absent',
          health: tailscale?.health ?? 'none',
        },
        dns: {
          provider: deps.config.acmeDnsProvider,
          cloudflareEnabled: deps.config.cloudflareEnabled,
          zone: deps.config.cloudflareZone,
        },
        tls: {
          enabled: deps.config.tlsEnabled,
          mode: deps.config.tlsMode,
          acmeEmailSet: deps.config.acmeEmailSet,
          caServer: deps.config.acmeCaServer,
        },
      }
      return c.json(view)
    },
  )

  return app
}
