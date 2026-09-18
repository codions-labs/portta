// Every translation the panel ships, as one object.
//
// The JSON is imported rather than fetched: the panel is offline software, and
// a locale that arrives over the network is a locale that can fail to arrive.
// Both halves read this — `client.ts` for the browser, `server.ts` for a Server
// Component — so a namespace exists once. Each official module's namespaces
// follow the base ones, from `modules/index.ts`.

import enAccess from '../../messages/en/access.json' with { type: 'json' }
import enActivity from '../../messages/en/activity.json' with { type: 'json' }
import enAuth from '../../messages/en/auth.json' with { type: 'json' }
import enCommon from '../../messages/en/common.json' with { type: 'json' }
import enDiagnostics from '../../messages/en/diagnostics.json' with { type: 'json' }
import enDocker from '../../messages/en/docker.json' with { type: 'json' }
import enEnvironments from '../../messages/en/environments.json' with { type: 'json' }
import enErrors from '../../messages/en/errors.json' with { type: 'json' }
import enGateway from '../../messages/en/gateway.json' with { type: 'json' }
import enIssues from '../../messages/en/issues.json' with { type: 'json' }
import enNav from '../../messages/en/nav.json' with { type: 'json' }
import enNetwork from '../../messages/en/network.json' with { type: 'json' }
import enOverview from '../../messages/en/overview.json' with { type: 'json' }
import enProjects from '../../messages/en/projects.json' with { type: 'json' }
import enRepositories from '../../messages/en/repositories.json' with { type: 'json' }
import enServices from '../../messages/en/services.json' with { type: 'json' }
import enSessions from '../../messages/en/sessions.json' with { type: 'json' }
import enSettings from '../../messages/en/settings.json' with { type: 'json' }
import ptAccess from '../../messages/pt-BR/access.json' with { type: 'json' }
import ptActivity from '../../messages/pt-BR/activity.json' with { type: 'json' }
import ptAuth from '../../messages/pt-BR/auth.json' with { type: 'json' }
import ptCommon from '../../messages/pt-BR/common.json' with { type: 'json' }
import ptDiagnostics from '../../messages/pt-BR/diagnostics.json' with { type: 'json' }
import ptDocker from '../../messages/pt-BR/docker.json' with { type: 'json' }
import ptEnvironments from '../../messages/pt-BR/environments.json' with { type: 'json' }
import ptErrors from '../../messages/pt-BR/errors.json' with { type: 'json' }
import ptGateway from '../../messages/pt-BR/gateway.json' with { type: 'json' }
import ptIssues from '../../messages/pt-BR/issues.json' with { type: 'json' }
import ptNav from '../../messages/pt-BR/nav.json' with { type: 'json' }
import ptNetwork from '../../messages/pt-BR/network.json' with { type: 'json' }
import ptOverview from '../../messages/pt-BR/overview.json' with { type: 'json' }
import ptProjects from '../../messages/pt-BR/projects.json' with { type: 'json' }
import ptRepositories from '../../messages/pt-BR/repositories.json' with { type: 'json' }
import ptServices from '../../messages/pt-BR/services.json' with { type: 'json' }
import ptSessions from '../../messages/pt-BR/sessions.json' with { type: 'json' }
import ptSettings from '../../messages/pt-BR/settings.json' with { type: 'json' }
import { withModuleResources } from '../../modules/index.ts'

export const RESOURCES = {
  en: withModuleResources(
    {
      common: enCommon,
      nav: enNav,
      overview: enOverview,
      projects: enProjects,
      repositories: enRepositories,
      environments: enEnvironments,
      issues: enIssues,
      sessions: enSessions,
      activity: enActivity,
      services: enServices,
      docker: enDocker,
      network: enNetwork,
      access: enAccess,
      gateway: enGateway,
      settings: enSettings,
      diagnostics: enDiagnostics,
      errors: enErrors,
      auth: enAuth,
    },
    'en',
  ),
  'pt-BR': withModuleResources(
    {
      common: ptCommon,
      nav: ptNav,
      overview: ptOverview,
      projects: ptProjects,
      repositories: ptRepositories,
      environments: ptEnvironments,
      issues: ptIssues,
      sessions: ptSessions,
      activity: ptActivity,
      services: ptServices,
      docker: ptDocker,
      network: ptNetwork,
      access: ptAccess,
      gateway: ptGateway,
      settings: ptSettings,
      diagnostics: ptDiagnostics,
      errors: ptErrors,
      auth: ptAuth,
    },
    'pt-BR',
  ),
} as const

export const LOCALES = ['en', 'pt-BR'] as const
export type Locale = (typeof LOCALES)[number]

/** The locale a header, a cookie or a stored choice is asking for, or null. */
export function normaliseLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  if (lower === 'pt' || lower === 'pt-br' || lower.startsWith('pt-')) return 'pt-BR'
  return null
}
