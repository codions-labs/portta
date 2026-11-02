'use client'

// The overview tab: what is running and what it costs.

import Link from 'next/link'
import type { Environment, Project, ProjectEnvironment } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { EnvironmentCard } from '@/components/entities/environment-card'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { Empty, SectionHeader } from '@/components/shell-bits'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { environmentHealth, healthTone } from '@/lib/health'
import { useEnvironments, useMetricsCurrent } from '@/lib/queries'

export function ProjectOverview({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const environments = useEnvironments(true)
  const metrics = useMetricsCurrent()

  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  const adopted = project.environments
    .map((entry) => known.get(entry.environment))
    .filter((environment): environment is Environment => environment !== undefined)
  const measured = (metrics.data?.projects ?? []).filter((entry) =>
    project.environments.some((link) => link.environment === entry.composeProject),
  )
  const cpu = measured.reduce<number | null>(
    (sum, entry) => (entry.cpuUtilisation === null ? sum : (sum ?? 0) + entry.cpuUtilisation),
    null,
  )
  const memory = measured.reduce<number | null>(
    (sum, entry) => (entry.memoryUsedBytes === null ? sum : (sum ?? 0) + entry.memoryUsedBytes),
    null,
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('overview.resources')} />
        <CardBody>
          {measured.length === 0 ? (
            <p className="text-xs text-subtle">{t('overview.noMeasurement')}</p>
          ) : (
            <ResourceUsage cpu={cpu} memoryBytes={memory} variant="bar" stale={metrics.data?.stale} />
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        <SectionHeader
          title={t('environments.title')}
          actions={
            <Link
              className="rounded-xs text-xs text-link hover:underline focus-ring"
              href={`/projects/${encodeURIComponent(project.slug)}/environments`}
            >
              {t('overview.manageEnvironments')}
            </Link>
          }
        />
        {project.environments.length === 0 ? (
          <Card>
            <Empty title={t('environments.empty')} hint={t('environments.emptyHint')} />
          </Card>
        ) : adopted.length === 0 ? (
          <Card>
            {project.environments.map((environment) => (
              <AdoptedRow key={environment.environment} environment={environment} />
            ))}
          </Card>
        ) : (
          adopted.map((environment) => (
            <EnvironmentCard
              key={environment.name}
              environment={environment}
              owner={{ slug: project.slug, name: project.name }}
              readOnly={readOnly}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * The adopted environment when the list does not carry it in full. One with no
 * services at all is a remembered one (its containers are gone), which the link
 * carries no presence for: "0/0 running" would be the wrong word.
 */
export function AdoptedRow({ environment }: { environment: ProjectEnvironment }) {
  const { t } = useTranslation('projects')
  const { t: te } = useTranslation('environments')
  const health = environmentHealth(environment)
  const remembered = environment.serviceCount === 0 && !environment.running
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-sm last:border-b-0 hover:bg-fill">
      <Link
        className="rounded-xs font-medium underline-offset-2 hover:underline focus-ring"
        href={`/environments/${encodeURIComponent(environment.environment)}`}
      >
        {environment.environment}
      </Link>
      {remembered ? (
        <Badge tone="outline">{te('presence.remembered')}</Badge>
      ) : (
        <StatusIndicator tone={healthTone(health)}>
          {t('running', { running: environment.runningCount, total: environment.serviceCount })}
        </StatusIndicator>
      )}
      {environment.unhealthyCount > 0 ? (
        <Badge tone="danger">{t('detail.unhealthyCount', { count: environment.unhealthyCount })}</Badge>
      ) : null}
      <span className="text-xs text-subtle">{t(sourceKey(environment.source))}</span>
    </div>
  )
}

export function sourceKey(
  source: ProjectEnvironment['source'],
): 'detail.sourceReason.label' | 'detail.sourceReason.path' | 'detail.sourceReason.manual' {
  return source === 'label'
    ? 'detail.sourceReason.label'
    : source === 'path'
      ? 'detail.sourceReason.path'
      : 'detail.sourceReason.manual'
}
