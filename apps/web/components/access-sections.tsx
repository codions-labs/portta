'use client'

// The top of Access: what it decides, and its two halves.

import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shell-bits'
import { LinkTabs } from '@/components/ui/tabs'
import { useAccess, useEnvironments } from '@/lib/queries'

export function AccessSections() {
  const { t } = useTranslation('access')
  const pathname = usePathname()
  const environments = useEnvironments(true)
  const access = useAccess()
  const sites = (environments.data ?? []).flatMap((environment) =>
    environment.presence === 'live' ? environment.services.filter((container) => container.urls.length > 0) : [],
  ).length
  const active = pathname.startsWith('/access/tcp') ? 'tcp' : 'sites'

  return (
    <>
      <PageHeader title={t('title')} description={active === 'tcp' ? t('description') : t('sites.description')} />
      <LinkTabs
        label={t('title')}
        active={active}
        tabs={[
          { id: 'sites', label: t('sites.tab'), href: '/access', count: sites },
          { id: 'tcp', label: t('tcp.tab'), href: '/access/tcp', count: access.data?.services.length },
        ]}
      />
    </>
  )
}
