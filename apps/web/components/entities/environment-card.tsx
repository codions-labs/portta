'use client'

import type { Environment } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { environmentHealth, healthTone } from '../../lib/health.ts'
import { useEnvironmentGit } from '../../lib/queries/index.ts'
import { serviceRowsFor } from '../../lib/services.ts'
import { useFormat } from '../../lib/use-format.ts'
import { EnvironmentActions } from '../environment-actions.tsx'
import { Badge, StatusIndicator } from '../ui/badge.tsx'
import { Card, CardHeader } from '../ui/card.tsx'
import { GitStatusLine } from './git-status-line.tsx'
import { EnvironmentOpenMenu } from './open-test-menu.tsx'
import { ServiceTable } from './service-table.tsx'

/**
 * One environment in a list: what it is, what code it runs, its services as
 * rows, and the actions that apply. The rows come from the container summary
 * the list already carries; the environment page measures them.
 */
export function EnvironmentCard({
  environment,
  owner = null,
  readOnly = false,
}: {
  environment: Environment
  /** The Project it was adopted by, when the list knows it. */
  owner?: { slug: string; name: string } | null
  readOnly?: boolean
}) {
  const { t } = useTranslation('environments')
  const { uptime } = useFormat()
  const git = useEnvironmentGit(environment.name)
  const health = environmentHealth(environment)
  const rows = serviceRowsFor(environment, null, readOnly).filter((row) => !row.hidden)
  const hidden = serviceRowsFor(environment, null, readOnly).filter((row) => row.hidden)
  const remembered = environment.presence === 'remembered'

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={`/environments/${encodeURIComponent(environment.name)}`}
              className="rounded-xs underline-offset-2 hover:underline focus-ring"
              title={environment.overrides?.displayName ? t('derivedName', { name: environment.name }) : undefined}
            >
              {environment.overrides?.displayName ?? environment.name}
            </a>
            {environment.overrides?.pinned ? <Badge tone="accent">{t('pinned')}</Badge> : null}
            {environment.overrides?.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
            {remembered ? (
              <Badge tone="outline">{t('presence.remembered')}</Badge>
            ) : (
              <StatusIndicator tone={healthTone(health)}>
                {t('running', { running: environment.runningCount, total: environment.serviceCount })}
              </StatusIndicator>
            )}
            {!remembered && environment.unhealthyCount > 0 ? (
              <StatusIndicator tone="danger">{t('unhealthy', { count: environment.unhealthyCount })}</StatusIndicator>
            ) : null}
            {environment.namespace ? (
              <Badge tone="outline">{t('worktree', { name: environment.namespace })}</Badge>
            ) : null}
            {owner ? (
              <a
                className="rounded-xs text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring"
                href={`/projects/${encodeURIComponent(owner.slug)}`}
              >
                {t('header.project')}: {owner.name}
              </a>
            ) : environment.group ? (
              <Badge tone="outline">{t('partOf', { group: environment.group })}</Badge>
            ) : (
              <span className="text-xs text-subtle">{t('header.noProject')}</span>
            )}
          </span>
        }
        description={
          [
            environment.overrides?.displayName ? environment.name : null,
            environment.overrides?.description ?? null,
            environment.uptimeSeconds !== null ? t('up', { time: uptime(environment.uptimeSeconds) }) : null,
            environment.workingDir,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <>
            {environment.urls.length > 0 ? <EnvironmentOpenMenu environment={environment} /> : null}
            <EnvironmentActions project={environment} />
          </>
        }
      />
      {git.data ? (
        <GitStatusLine git={git.data} variant="line" className="border-b border-line" refreshHint={false} />
      ) : null}
      <ServiceTable
        services={rows}
        containers={environment.services}
        emptyTitle={t(remembered ? 'servicesTable.emptyRemembered' : 'servicesTable.empty')}
      />
      {hidden.length > 0 ? (
        <details className="border-t border-line px-3 py-2">
          <summary className="cursor-pointer text-xs text-subtle">
            {t(hidden.length === 1 ? 'collapsedService' : 'collapsedServices', { count: hidden.length })}
          </summary>
          <div className="-mx-3 mt-2">
            <ServiceTable services={hidden} containers={environment.services} />
          </div>
        </details>
      ) : null}
    </Card>
  )
}
