'use client'

// The top of every Host page: which machine this is, and its sections.

import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shell-bits'
import { LinkTabs } from '@/components/ui/tabs'
import { usePrincipal } from '@/lib/principal'
import { useMetricsCurrent } from '@/lib/queries'
import { visibleHostSections } from './sections'

export function HostSections() {
  const { t } = useTranslation('nav')
  const pathname = usePathname()
  const metrics = useMetricsCurrent()
  const sections = visibleHostSections(usePrincipal().permissions)
  const hostname = metrics.data?.host?.hostname ?? metrics.data?.instance.hostname ?? t('host')
  // `/host` is a prefix of every other section, so the longest match is the page.
  const active = [...sections]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))

  return (
    <>
      <PageHeader title={hostname} description={t('hostDescription')} />
      <LinkTabs
        label={t('host')}
        active={active?.id ?? ''}
        tabs={sections.map((section) => ({
          id: section.id,
          label: t(`hostSections.${section.id}`),
          href: section.href,
        }))}
      />
    </>
  )
}
