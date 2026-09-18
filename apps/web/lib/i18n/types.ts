import type access from '../../messages/en/access.json'
import type activity from '../../messages/en/activity.json'
import type auth from '../../messages/en/auth.json'
import type common from '../../messages/en/common.json'
import type diagnostics from '../../messages/en/diagnostics.json'
import type docker from '../../messages/en/docker.json'
import type environments from '../../messages/en/environments.json'
import type errors from '../../messages/en/errors.json'
import type gateway from '../../messages/en/gateway.json'
import type issues from '../../messages/en/issues.json'
import type nav from '../../messages/en/nav.json'
import type network from '../../messages/en/network.json'
import type overview from '../../messages/en/overview.json'
import type projects from '../../messages/en/projects.json'
import type repositories from '../../messages/en/repositories.json'
import type services from '../../messages/en/services.json'
import type sessions from '../../messages/en/sessions.json'
import type settings from '../../messages/en/settings.json'
import type { ModuleResources } from '../../modules/index.ts'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      nav: typeof nav
      overview: typeof overview
      projects: typeof projects
      repositories: typeof repositories
      environments: typeof environments
      issues: typeof issues
      sessions: typeof sessions
      activity: typeof activity
      services: typeof services
      docker: typeof docker
      network: typeof network
      access: typeof access
      gateway: typeof gateway
      settings: typeof settings
      diagnostics: typeof diagnostics
      errors: typeof errors
      auth: typeof auth
    } & ModuleResources<'en'>
  }
}
