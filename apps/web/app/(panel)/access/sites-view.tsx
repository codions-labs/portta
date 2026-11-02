'use client'

// Every address this host answers on, and who may open each. The decision sits
// on the row: walking to a service to change it is what this page replaces.

import { ChevronRight, Link2 } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { ContainerSummary, Environment } from 'portta-contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Mono } from '@/components/copy'
import { ExposureChoice, useExposureDecision } from '@/components/exposure-panel'
import { Callout, Empty, ErrorBox, FilterChip, Loading, ToolbarSearch, ViewToolbar } from '@/components/shell-bits'
import { ScopeBadge } from '@/components/status'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { canonicalHost, hostAccess } from '@/lib/host-access'
import { useCan } from '@/lib/permissions'
import { useEnvironments, useExposure, useShares } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

type Decision = 'protected' | 'public' | 'closed' | 'unprotected' | 'none'

interface Site {
  environment: Environment
  container: ContainerSummary
  service: string
  host: string
  url: string
  scope: ContainerSummary['urls'][number]['scope']
  /** One service with an alias answers on several names, and each is decided from the CLI. */
  hosts: number
  decision: Decision
  user: string | null
}

function SiteRow({ site, mayDecide, enforced }: { site: Site; mayDecide: boolean; enforced: boolean }) {
  const { t } = useTranslation('access', { keyPrefix: 'sites' })
  const { expiresIn } = useFormat()
  const shares = useShares()
  const decision = useExposureDecision(site.container)
  const share = shares.data?.shares.find((entry) => entry.container === site.container.name && entry.state === 'active')
  const service = `/environments/${encodeURIComponent(site.environment.name)}?service=${encodeURIComponent(site.service)}`

  return (
    <li className="border-t border-line first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 transition-colors duration-100 hover:bg-fill">
        <div className="min-w-0 flex-[2_1_17rem]">
          <a
            className="block truncate rounded-xs underline-offset-2 hover:underline focus-ring"
            href={site.url}
            target="_blank"
            rel="noreferrer"
          >
            <Mono kind="url" value={site.url} className="text-link">
              {site.host}
            </Mono>
          </a>
          <div className="truncate text-xs text-subtle">
            {site.environment.overrides?.displayName ?? site.environment.name} · {site.service}
            {site.hosts > 1 ? ` · ${t('moreHosts', { count: site.hosts - 1 })}` : ''}
          </div>
        </div>
        <div className="w-16 shrink-0">
          <ScopeBadge scope={site.scope} />
        </div>
        <div className="flex w-64 shrink-0 items-center">
          {!enforced ? (
            <Badge>{t('noLogin')}</Badge>
          ) : site.decision === 'unprotected' ? (
            <Badge tone="danger">{t('decision.unprotected')}</Badge>
          ) : site.hosts > 1 || !mayDecide ? (
            <Badge tone={site.decision === 'protected' ? 'ok' : site.decision === 'public' ? 'info' : 'warn'}>
              {t(`decision.${site.decision}`)}
            </Badge>
          ) : (
            <ExposureChoice
              compact
              current={site.decision === 'none' ? 'closed' : site.decision}
              decision={decision}
              host={site.host}
            />
          )}
        </div>
        <div className="min-w-0 flex-[1_1_8rem] text-xs text-subtle">
          {share
            ? t(share.mode === 'protected' ? 'linkProtected' : 'linkPublic', { time: expiresIn(share.expiresAt) })
            : t('noLink')}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyButton value={site.url} />
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={`${service}&section=share`} aria-label={t('createLink', { host: site.host })}>
              <Link2 />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={service} aria-label={t('details', { name: site.service })}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
      </div>
      {decision.password ? (
        <div className="px-5 pb-3">
          <Callout
            tone="warn"
            title={
              <>
                {t('nowAsks', { host: site.host })}{' '}
                <Mono kind="text" tone="ink">
                  {decision.password}
                </Mono>
                <CopyButton value={decision.password} className="ml-1 align-middle" />
              </>
            }
          >
            {t('shownOnce')}
          </Callout>
        </div>
      ) : null}
      {decision.error ? <div className="px-5 pb-3 text-sm text-danger">{decision.error.message}</div> : null}
    </li>
  )
}

export function SitesView() {
  const { t } = useTranslation('access', { keyPrefix: 'sites' })
  const environments = useEnvironments(true)
  const exposure = useExposure()
  const mayDecide = useCan('service:protect')
  const [search, setSearch] = useState('')
  // The command menu links straight to one of these.
  const asked = useSearchParams().get('filter')
  const [filter, setFilter] = useState<'all' | Decision>(asked === 'closed' ? 'closed' : 'all')
  const enforced = exposure.data?.enforced ?? false

  const sites = useMemo<Site[]>(() => {
    const entries = new Map((exposure.data?.entries ?? []).map((entry) => [canonicalHost(entry.host), entry]))
    return (environments.data ?? [])
      .filter((environment) => environment.presence === 'live')
      .flatMap((environment) =>
        environment.services
          .filter((container) => container.urls.length > 0)
          .map((container): Site => {
            const route = container.urls[0]!
            const hosts = new Set(container.urls.map((url) => canonicalHost(url.host)))
            const entry = entries.get(canonicalHost(route.host))
            return {
              environment,
              container,
              service: container.service ?? container.name,
              host: route.host,
              url: route.url,
              scope: route.scope,
              hosts: hosts.size,
              decision: !exposure.data?.enforced ? 'none' : hostAccess(environment, route.host, exposure.data),
              user: entry?.user ?? null,
            }
          }),
      )
      .sort((a, b) => a.host.localeCompare(b.host))
  }, [environments.data, exposure.data])

  // Without the registry nothing here can be said about who may open what.
  if (environments.isPending || exposure.isPending) return <Loading />
  if (environments.error || exposure.error) return <ErrorBox error={environments.error ?? exposure.error} />

  const needle = search.trim().toLowerCase()
  const shown = sites.filter(
    (site) =>
      (filter === 'all' || site.decision === filter) &&
      (needle === '' || `${site.host} ${site.environment.name} ${site.service}`.toLowerCase().includes(needle)),
  )
  const count = (decision: Decision) => sites.filter((site) => site.decision === decision).length
  const unknown = exposure.data?.openRouters ?? { count: 0, names: [] }

  return (
    <>
      <ViewToolbar
        trailing={
          <ToolbarSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
          />
        }
      >
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('filters.all', { count: sites.length })}
        </FilterChip>
        {enforced ? (
          <>
            {count('unprotected') > 0 ? (
              <FilterChip active={filter === 'unprotected'} onClick={() => setFilter('unprotected')}>
                <StatusDot tone="danger" label={t('decision.unprotected')} />
                {t('filters.unprotected', { count: count('unprotected') })}
              </FilterChip>
            ) : null}
            <FilterChip active={filter === 'closed'} onClick={() => setFilter('closed')}>
              {count('closed') > 0 ? <StatusDot tone="warn" label={t('decision.closed')} /> : null}
              {t('filters.closed', { count: count('closed') })}
            </FilterChip>
            <FilterChip active={filter === 'protected'} onClick={() => setFilter('protected')}>
              {t('filters.protected', { count: count('protected') })}
            </FilterChip>
            <FilterChip active={filter === 'public'} onClick={() => setFilter('public')}>
              {t('filters.public', { count: count('public') })}
            </FilterChip>
          </>
        ) : null}
      </ViewToolbar>

      {unknown.count > 0 ? (
        <Callout tone="danger" className="mb-4" title={t('unknownRouters', { count: unknown.count })}>
          {unknown.names.length > 0 ? (
            <Mono kind="text" tone="ink">
              {unknown.names.join(', ')}
            </Mono>
          ) : null}
          <p className="mt-1">{t('unknownRoutersHint')}</p>
        </Callout>
      ) : null}

      <Card>
        {shown.length === 0 ? (
          <Empty title={sites.length === 0 ? t('empty') : t('noMatch')} />
        ) : (
          <ul aria-label={t('title')}>
            {shown.map((site) => (
              <SiteRow key={site.container.id} site={site} mayDecide={mayDecide} enforced={enforced} />
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-subtle">{enforced ? t('footPublic') : t('footLocal')}</p>
    </>
  )
}
