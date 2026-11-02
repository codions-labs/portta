'use client'

// The top of every environment tab: what it is, what it belongs to, how it is
// doing, and the operations its state allows.

import { useRouter } from 'next/navigation'
import type { Environment } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { EnvironmentOpenMenu } from '@/components/entities/open-test-menu'
import { EnvironmentActions } from '@/components/environment-actions'
import { EnvironmentOperations } from '@/components/environment-operations'
import { PageHeader } from '@/components/shell-bits'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import type { BreadcrumbItem } from '@/components/ui/breadcrumb'
import { environmentHealth, healthTone } from '@/lib/health'
import { useCan } from '@/lib/permissions'
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

  const breadcrumb: BreadcrumbItem[] = owner
    ? [
        { label: tn('projects'), href: '/projects' },
        { label: owner.name, href: `/projects/${encodeURIComponent(owner.slug)}` },
        { label: tn('environments'), href: `/projects/${encodeURIComponent(owner.slug)}/environments` },
        { label: shown },
      ]
    : [{ label: tn('environments'), href: '/projects?view=environments' }, { label: shown }]

  return (
    <PageHeader
      title={shown}
      breadcrumb={breadcrumb}
      description={
        [
          environment.overrides?.displayName ? t('derivedName', { name: environment.name }) : null,
          environment.overrides?.description ?? null,
          environment.uptimeSeconds !== null ? t('up', { time: uptime(environment.uptimeSeconds) }) : null,
          environment.workingDir,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      meta={
        <>
          {remembered ? (
            <Badge tone="outline">{t('presence.remembered')}</Badge>
          ) : (
            <StatusIndicator tone={narrowTone(healthTone(health))}>
              {t('header.services', { running: environment.runningCount, total: environment.serviceCount })}
            </StatusIndicator>
          )}
          {!remembered && environment.unhealthyCount > 0 ? (
            <StatusIndicator tone="danger">{t('unhealthy', { count: environment.unhealthyCount })}</StatusIndicator>
          ) : null}
          {owner ? null : environment.group ? (
            <Badge tone="outline">{t('partOf', { group: environment.group })}</Badge>
          ) : (
            <span className="text-subtle">{t('header.noProject')}</span>
          )}
          {environment.namespace ? (
            <Badge tone="outline">{t('worktree', { name: environment.namespace })}</Badge>
          ) : null}
          <Mono kind="text" tone="subtle" className="text-xs">
            {environment.networks.join(', ')}
          </Mono>
        </>
      }
      actions={
        <>
          {environment.urls.length > 0 ? <EnvironmentOpenMenu environment={environment} /> : null}
          {/* Start, stop and restart are `environment:operate`. Forgetting
                the panel's row, rebuilding and removing are `destroy`, and a
                developer holds the first and not the second. */}
          {mayOperate ? (
            <EnvironmentActions
              project={environment}
              mayForget={mayDestroy}
              onForgotten={() => router.push('/projects?view=environments')}
            />
          ) : null}
          {remembered || !mayDestroy ? null : <EnvironmentOperations project={environment} />}
        </>
      }
    />
  )
}
