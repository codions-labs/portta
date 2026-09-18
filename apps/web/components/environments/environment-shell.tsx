'use client'

// The frame every environment tab is rendered in.
//
// The environment itself is a query, so the header and the tab bar are here
// rather than in the layout: the layout would have to fetch it on the server
// and every tab would fetch it again anyway. What the layout does is decide
// that this page exists at all.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { Card } from '@/components/ui/card'
import { type TabDefinition, TabPanel, Tabs } from '@/components/ui/tabs'
import { ApiError } from '@/lib/api'
import { useEnvironment, useEnvironmentOwners } from '@/lib/queries'
import { EnvironmentHeader } from './environment-header'

const TABS = ['overview', 'logs', 'settings'] as const
export type EnvironmentTab = (typeof TABS)[number]

/** `services` and `git` were tabs once; they are the overview and the repository now. */
export function resolveTab(requested: string | null | undefined): EnvironmentTab {
  return TABS.includes(requested as EnvironmentTab) ? (requested as EnvironmentTab) : 'overview'
}

/** `/environments/alpha/logs` is the logs tab; `/environments/alpha` is the overview. */
export function tabFromPath(pathname: string, name: string): EnvironmentTab {
  const base = `/environments/${encodeURIComponent(name)}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : ''
  return resolveTab(rest.split('/')[0] ?? null)
}

export function EnvironmentShell({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useTranslation('environments')
  const pathname = usePathname()
  const query = useEnvironment(name)
  const { owners } = useEnvironmentOwners()
  const owner = owners.get(name) ?? null
  const tab = tabFromPath(pathname, name)

  if (query.isPending) return <Loading />

  if (query.error) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    if (!missing) return <ErrorBox error={query.error} />
    return (
      <>
        <PageHeader title={name} />
        <Card>
          <Empty
            title={t('notFound', { name })}
            hint={
              <Link className="rounded-xs text-accent hover:underline focus-ring" href="/environments">
                {t('backToAll')}
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const environment = query.data!
  const tabs: TabDefinition[] = TABS.map((id) => ({
    id,
    label: t(`tabs.${id}`),
    href:
      id === 'overview'
        ? `/environments/${encodeURIComponent(name)}`
        : `/environments/${encodeURIComponent(name)}/${id}`,
  }))

  return (
    <>
      <EnvironmentHeader environment={environment} owner={owner} />
      <Tabs tabs={tabs} active={tab} label={`${name} sections`} />
      <TabPanel id={tab}>{children}</TabPanel>
    </>
  )
}
