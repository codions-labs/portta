'use client'

// The top of every Project tab: what it is, how it is doing, and the one
// action a person came to take.

import type { Environment, Project } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { EnvironmentOpenMenu } from '@/components/entities/open-test-menu'
import { PageHeader } from '@/components/shell-bits'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { useEnvironments, useSessions } from '@/lib/queries'

/** The environment the Open menu targets: the first running one, else the first. */
function primaryEnvironment(project: Project, environments: Environment[]): Environment | null {
  const known = new Map(environments.map((environment) => [environment.name, environment]))
  const adopted = project.environments
    .map((entry) => known.get(entry.environment))
    .filter((environment): environment is Environment => environment !== undefined)
  return adopted.find((environment) => environment.runningCount > 0) ?? adopted[0] ?? null
}

export function ProjectHeader({ project }: { project: Project }) {
  const { t } = useTranslation('projects')
  const { t: tn } = useTranslation('nav')
  const sessions = useSessions(project.slug, { active: true })
  const environments = useEnvironments(true)

  const primary = primaryEnvironment(project, environments.data ?? [])
  const running = project.environments.filter((entry) => entry.running).length
  const unhealthy = project.environments.reduce((sum, entry) => sum + entry.unhealthyCount, 0)
  const active = (sessions.data ?? []).length

  return (
    <PageHeader
      title={project.name}
      breadcrumb={[{ label: tn('projects'), href: '/projects' }, { label: project.name }]}
      description={project.description ?? undefined}
      meta={
        <>
          {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          {project.environments.length > 0 ? (
            <StatusIndicator tone={unhealthy > 0 ? 'danger' : running > 0 ? 'ok' : 'neutral'}>
              {t('running', { running, total: project.environments.length })}
              {unhealthy > 0 ? ` · ${t('pulse.unhealthy', { count: unhealthy })}` : ''}
            </StatusIndicator>
          ) : null}
          {active > 0 ? (
            <StatusIndicator tone="agent" pulse>
              {t('pulse.sessions', { count: active })}
            </StatusIndicator>
          ) : null}
        </>
      }
      actions={primary ? <EnvironmentOpenMenu environment={primary} /> : null}
    />
  )
}
