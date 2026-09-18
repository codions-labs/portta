// The gateway overview: how many of what is running, and what is wrong.
//
// `GET /api/status` and the panel's own shell both ask for it, so it is
// assembled here rather than inside the route that happens to publish it.

import type { Overview, OverviewCounts } from 'portta-contracts'
import type { AppDeps } from '../deps.ts'
import { listBridges, listForwarders } from './access.ts'
import { diagnose, problemsOnly } from './diagnostics.ts'
import { gatewayStatus } from './gateway.ts'
import { forgeStatus } from './issues/host-client.ts'
import { loadAliases } from './overrides.ts'
import { listShares } from './shares.ts'

export async function panelOverview(deps: AppDeps): Promise<Overview> {
  // One call, reused by the diagnostics below and by the response: asking the
  // daemon twice for the same answer would double the cost of the panel's
  // busiest page.
  const forge = await forgeStatus(deps.forge)
  const snapshot = await deps.cache.get()
  const gateway = gatewayStatus(snapshot, deps.config)
  const integrated = snapshot.environments.filter((environment) => environment.integrated)
  const running = snapshot.containers.filter((container) => container.state === 'running')
  // Shares are on the Overview so they are visible without being looked
  // for: an exposure nobody remembers is the failure mode worth catching.
  const shares = listShares(deps.config, snapshot)

  const counts: OverviewCounts = {
    projects: snapshot.environments.length,
    integratedProjects: integrated.length,
    services: integrated.reduce((total, project) => total + project.serviceCount, 0),
    servicesRunning: integrated.reduce((total, project) => total + project.runningCount, 0),
    servicesHealthy: integrated.reduce((total, project) => total + project.healthyCount, 0),
    servicesUnhealthy: integrated.reduce((total, project) => total + project.unhealthyCount, 0),
    containersTotal: snapshot.containers.length,
    containersRunning: running.length,
    containersGateway: running.filter((container) => container.ownership === 'gateway').length,
    containersIntegrated: running.filter((container) => container.ownership === 'integrated').length,
    containersExternal: running.filter((container) => container.ownership === 'external').length,
    containersStandalone: running.filter((container) => container.ownership === 'standalone').length,
    bridges: listBridges(snapshot).filter((bridge) => bridge.state === 'running').length,
    forwarders: listForwarders(snapshot).filter((forwarder) => forwarder.state === 'running').length,
    routes: gateway.routes,
    shares: shares.filter((share) => share.state === 'active').length,
    sharesStale: shares.filter((share) => share.state !== 'active').length,
  }

  const overview: Overview = {
    gateway,
    counts,
    urls: snapshot.containers
      .filter((container) => container.ownership !== 'gateway' && container.state === 'running')
      .flatMap((container) => container.urls),
    problems: problemsOnly(
      diagnose(snapshot, deps.config, null, shares, deps.db.status(), loadAliases(deps.config), forge),
    ),
    generatedAt: snapshot.at,
    forge,
  }
  return overview
}
