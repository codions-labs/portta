'use client'

// The services of one environment, with what each costs and what it serves.

import { useRouter, useSearchParams } from 'next/navigation'
import type { Environment } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { ServiceTable } from '@/components/entities/service-table'
import { Loading } from '@/components/shell-bits'
import { Card, CardHeader } from '@/components/ui/card'
import { useEnvironment, useEnvironmentServices } from '@/lib/queries'
import { serviceRowsFor } from '@/lib/services'

export function EnvironmentOverview({ name }: { name: string }) {
  const { t } = useTranslation('environments')
  const router = useRouter()
  const params = useSearchParams()
  const environmentQuery = useEnvironment(name)
  const served = useEnvironmentServices(name)
  const environment = environmentQuery.data
  if (!environment) return <Loading />

  const rows = serviceRowsFor(environment, served.data?.services ?? null)
  const summary = served.data?.resources ?? null
  const base = `/environments/${encodeURIComponent(name)}`

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('tabs.overview')}
          description={served.error ? t('servicesTable.fallback') : undefined}
          actions={
            summary ? (
              <ResourceUsage
                cpu={summary.cpuUtilisation}
                memoryBytes={summary.memoryUsedBytes}
                memoryLimitBytes={summary.memoryLimitBytes}
                diskBytes={summary.diskBytes}
                stale={summary.stale}
              />
            ) : null
          }
        />
        {served.isPending && rows.length === 0 ? (
          <Loading />
        ) : (
          <ServiceTable
            services={rows}
            containers={environment.services}
            initialService={params.get('service')}
            // The selected service is in the URL, so an open drawer is a link.
            onSelect={(next) => router.push(next ? `${base}?service=${encodeURIComponent(next)}` : base)}
            emptyTitle={t(
              environment.presence === 'remembered' ? 'servicesTable.emptyRemembered' : 'servicesTable.empty',
            )}
            emptyHint={environment.presence === 'remembered' ? undefined : t('servicesEmptyHint')}
          />
        )}
      </Card>
      <WorkingDirectory environment={environment} />
    </div>
  )
}

function WorkingDirectory({ environment }: { environment: Environment }) {
  const { t } = useTranslation('environments')
  if (!environment.workingDir && !environment.gitRoot) return null
  return (
    <div className="flex flex-wrap items-center gap-x-1 px-1 text-xs text-subtle">
      {environment.workingDir ? <Mono kind="path" tone="subtle" value={environment.workingDir} /> : null}
      {environment.gitRoot && environment.gitRoot !== environment.workingDir ? (
        <span className="flex min-w-0 items-center gap-1">
          {' '}
          · {t('environment.gitRoot')}: <Mono kind="path" tone="subtle" value={environment.gitRoot} />
        </span>
      ) : null}
    </div>
  )
}
