'use client'

// The tabs of a Project, and which one the URL is on.
//
// A tab is a route, so the count beside each label comes from what the server
// already read for this render rather than from a query the tab bar starts.

import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Tabs } from '@/components/ui/tabs'

const TABS = ['overview', 'environments', 'settings'] as readonly string[]
export type ProjectTab = 'overview' | 'environments' | 'settings'

/** `/projects/shop/environments/alpha` is still the environments tab. */
export function tabFromPath(pathname: string, slug: string): ProjectTab {
  const base = `/projects/${encodeURIComponent(slug)}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : ''
  const first = rest.split('/')[0] ?? ''
  return TABS.includes(first) ? (first as ProjectTab) : 'overview'
}

export function ProjectTabs({ slug, name, environments }: { slug: string; name: string; environments: number }) {
  const { t } = useTranslation('projects')
  const pathname = usePathname()
  const base = `/projects/${encodeURIComponent(slug)}`
  return (
    <Tabs
      label={t('tabs.label', { name })}
      active={tabFromPath(pathname, slug)}
      tabs={[
        { id: 'overview', label: t('tabs.overview'), href: base },
        { id: 'environments', label: t('tabs.environments', { count: environments }), href: `${base}/environments` },
        { id: 'settings', label: t('tabs.settings'), href: `${base}/settings` },
      ]}
    />
  )
}
