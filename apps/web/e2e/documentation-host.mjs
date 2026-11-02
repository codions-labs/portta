// A documented demo host, separate from the viewport stress fixture.
// Public services carry the same ForwardAuth labels as an adopted runtime.
import { initialState as demoState, INFO, NETWORKS } from './demo-host.mjs'

export { INFO, NETWORKS }

export function initialState() {
  // The panel uses SQLite in process; there is no gateway database container.
  const containers = demoState().filter((container) => container.id !== 'gwdb')
  if (process.env.PORTTA_E2E_PROFILE !== 'remote-public') return containers
  for (const container of containers) {
    const labels = container.item.Labels
    const service = Object.keys(labels).find((key) =>
      /^traefik\.http\.services\..+\.loadbalancer\.server\.port$/.test(key),
    )
    if (!service) continue
    const router = service.split('.')[3]
    for (const key of Object.keys(labels)) {
      if (key.startsWith('traefik.http.routers.')) delete labels[key]
    }
    labels[`traefik.http.routers.${router}.rule`] = `Host(\`${router}.portta.test\`)`
    labels[`traefik.http.routers.${router}.entrypoints`] = 'websecure'
    labels[`traefik.http.routers.${router}.tls`] = 'true'
    labels[`traefik.http.routers.${router}.middlewares`] = 'portta-forward-auth@file'
  }
  return containers
}
