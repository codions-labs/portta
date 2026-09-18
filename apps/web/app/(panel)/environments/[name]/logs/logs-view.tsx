'use client'

import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { EnvironmentLogs } from '@/components/environment-logs'
import { Empty, Loading } from '@/components/shell-bits'
import { Card } from '@/components/ui/card'
import { useEnvironment } from '@/lib/queries'

export function LogsView({ name }: { name: string }) {
  const { t } = useTranslation('environments')
  const params = useSearchParams()
  const query = useEnvironment(name)
  const environment = query.data
  if (!environment) return <Loading />
  // A remembered environment has no containers, so it has no logs to read.
  if (environment.presence === 'remembered') {
    return (
      <Card>
        <Empty title={t('servicesTable.emptyRemembered')} />
      </Card>
    )
  }
  return <EnvironmentLogs project={environment} service={params.get('service')} />
}
