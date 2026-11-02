'use client'

// The top of every environment tab: what it is, what it belongs to, how it is
// doing, and the operations its state allows.

import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { Environment } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { primaryRoute } from '@/components/entities/environment-row'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { EnvironmentActions } from '@/components/environment-actions'
import { EnvironmentOperations } from '@/components/environment-operations'
import { PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import type { BreadcrumbItem } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { environmentHealth, healthTone } from '@/lib/health'
import { useCan } from '@/lib/permissions'
import { useEnvironmentServices } from '@/lib/queries'
import type { EnvironmentOwner } from '@/lib/queries/projects'
import { narrowTone } from '@/lib/tone'
import { useFormat } from '@/lib/use-format'

export function EnvironmentHeader({
  environment,
  owner,
}: {
  environment: Environment
  owner: EnvironmentOwner | null
}) {
  const { t } = useTranslation('environments')
  const { t: tn } = useTranslation('nav')
  const { uptime } = useFormat()
  const router = useRouter()
  const health = environmentHealth(environment)
  const remembered = environment.presence === 'remembered'
  const shown = environment.overrides?.displayName ?? environment.name
  const mayOperate = useCan('environment:operate')
  const mayDestroy = useCan('environment:destroy')
  const served = useEnvironmentServices(environment.name)
  const summary = served.data?.resources ?? null
  const route = primaryRoute(environment)

  const breadcrumb: BreadcrumbItem[] = owner
    ? [
        { label: tn('projects'), href: '/projects' },
        { label: owner.name, href: `/projects/${encodeURIComponent(owner.slug)}` },
        { label: shown },
      ]
    : [{ label: tn('environments'), href: '/projects' }, { label: shown }]

  return (
    <PageHeader
      title={shown}
      breadcrumb={breadcrumb}
      description={
        [
          environment.overrides?.displayName ? t('derivedName', { name: environment.name }) : null,
          environment.overrides?.description ?? null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      meta={
        <>
          {remembered ? (
            <Badge tone="outline">{t('presence.remembered')}</Badge>
          ) : (
            <Badge tone={narrowTone(healthTone(health))}>{t(`healthWord.${health}`)}</Badge>
          )}
          {remembered ? null : (
            <span>{t('header.services', { running: environment.runningCount, total: environment.serviceCount })}</span>
          )}
          {summary ? (
            <ResourceUsage
              cpu={summary.cpuUtilisation}
              memoryBytes={summary.memoryUsedBytes}
              memoryLimitBytes={summary.memoryLimitBytes}
              stale={summary.stale}
            />
          ) : null}
          {environment.uptimeSeconds !== null ? (
            <span>{t('up', { time: uptime(environment.uptimeSeconds) })}</span>
          ) : null}
          {owner ? null : environment.group ? (
            <Badge tone="outline">{t('partOf', { group: environment.group })}</Badge>
          ) : (
            <span className="text-subtle">{t('header.noProject')}</span>
          )}
          {environment.namespace ? (
            <Badge tone="outline">{t('worktree', { name: environment.namespace })}</Badge>
          ) : null}
          {environment.workingDir ? <Mono kind="path" tone="subtle" value={environment.workingDir} /> : null}
        </>
      }
      actions={
        <>
          {/* Start, stop and restart are `environment:operate`. Forgetting
                the panel's row, rebuilding and removing are `destroy`, and a
                developer holds the first and not the second. */}
          {mayOperate ? (
            <EnvironmentActions
              project={environment}
              mayForget={mayDestroy}
              onForgotten={() => router.push('/projects')}
            />
          ) : null}
          {remembered || !mayDestroy ? null : <EnvironmentOperations project={environment} />}
          {route ? (
            <Button asChild variant="primary">
              <a href={route.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t('openSite')}
              </a>
            </Button>
          ) : null}
        </>
      }
    />
  )
}
