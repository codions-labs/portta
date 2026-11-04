import type access from '../../messages/en/access.json'
import type auth from '../../messages/en/auth.json'
import type cleanup from '../../messages/en/cleanup.json'
import type common from '../../messages/en/common.json'
import type diagnostics from '../../messages/en/diagnostics.json'
import type docker from '../../messages/en/docker.json'
import type environments from '../../messages/en/environments.json'
import type errors from '../../messages/en/errors.json'
import type gateway from '../../messages/en/gateway.json'
import type host from '../../messages/en/host.json'
import type nav from '../../messages/en/nav.json'
import type network from '../../messages/en/network.json'
import type overview from '../../messages/en/overview.json'
import type projects from '../../messages/en/projects.json'
import type services from '../../messages/en/services.json'
import type settings from '../../messages/en/settings.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      nav: typeof nav
      overview: typeof overview
      projects: typeof projects
      environments: typeof environments
      services: typeof services
      docker: typeof docker
      cleanup: typeof cleanup
      host: typeof host
      network: typeof network
      access: typeof access
      gateway: typeof gateway
      settings: typeof settings
      diagnostics: typeof diagnostics
      errors: typeof errors
      auth: typeof auth
    }
  }
}
