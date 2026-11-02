'use client'

// How this machine is reached, and the Docker networks underneath. Changing any
// of it happens in Settings; which address answers what is in Access.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Empty, ErrorBox, Loading, NoValue } from '@/components/shell-bits'
import { StateBadge } from '@/components/status'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { useCan } from '@/lib/permissions'
import { useNetwork } from '@/lib/queries'

const ROLE_TONE = {
  shared: 'accent',
  control: 'info',
  access: 'info',
  project: 'neutral',
  other: 'outline',
} as const

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right first-letter:uppercase">{children}</span>
    </div>
  )
}

function ReachCard({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation('network')
  const mayChange = useCan('settings:read')
  return (
    <Card>
      <CardHeader
        title={title}
        actions={
          mayChange ? (
            <Link
              href="/settings/general"
              className="rounded-xs text-sm font-medium text-link underline-offset-2 hover:underline focus-ring"
            >
              {t('change')}
            </Link>
          ) : null
        }
      />
      <div className="space-y-1.5 px-5 py-4">{children}</div>
    </Card>
  )
}

export function NetworkView() {
  const { t } = useTranslation('network')
  const { t: tc } = useTranslation('common')
  const query = useNetwork()

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { domains, networks, tailscale, dns, tls } = query.data
  const validation = [tls.mode, dns.cloudflareEnabled ? (dns.zone ?? dns.provider) : null].filter(Boolean).join(', ')

  return (
    <div className="space-y-5">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <ReachCard title={t('domains.title')}>
          <Row label={t('domains.routedDomain')}>
            <Mono kind="host" tone="ink">
              {domains.local}
            </Mono>
          </Row>
          {domains.public && domains.public !== domains.local ? (
            <Row label={t('domains.publicDomain')}>
              <Mono kind="host" tone="ink">
                {domains.public}
              </Mono>
            </Row>
          ) : null}
          <Row label={t('domains.scheme')}>
            <Mono kind="text" tone="ink">
              {domains.scheme}
            </Mono>
          </Row>
        </ReachCard>

        <ReachCard title={t('tls.title')}>
          <Row label={t('tls.https')}>
            <StatusIndicator tone={tls.enabled ? 'ok' : 'neutral'} emphasis="ink">
              {tls.enabled ? tc('enabled') : tc('disabled')}
            </StatusIndicator>
          </Row>
          <Row label={t('tls.mode')}>
            <span title={tls.caServer}>
              <Mono kind="text" tone="ink">
                {validation}
              </Mono>
            </span>
          </Row>
          {tls.enabled && !tls.acmeEmailSet ? (
            <Row label={t('tls.acmeContact')}>
              <StatusIndicator tone="warn" emphasis="ink">
                {tc('notSet')}
              </StatusIndicator>
            </Row>
          ) : null}
        </ReachCard>

        <ReachCard title={t('vpnDns.title')}>
          <Row label={t('vpnDns.tailscale')}>
            {tailscale.enabled ? (
              <StateBadge state={tailscale.state} health={tailscale.health} />
            ) : (
              <StatusIndicator tone="neutral" emphasis="ink">
                {tc('disabled')}
              </StatusIndicator>
            )}
          </Row>
          <Row label={t('domains.vpnDomain')}>
            {domains.private ? (
              <Mono kind="host" tone="ink">
                {domains.private}
              </Mono>
            ) : (
              <NoValue />
            )}
          </Row>
        </ReachCard>
      </div>

      <Card>
        <CardHeader
          title={t('networks.title')}
          actions={<span className="text-xs text-subtle tabular-nums">{networks.length}</span>}
        />
        {networks.length === 0 ? (
          <Empty title={t('networks.empty')} />
        ) : (
          <ul aria-label={t('networks.title')}>
            {networks.map((network) => (
              <li
                key={network.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 first:border-t-0"
              >
                <Mono kind="host" tone="ink" className="min-w-0 flex-[1_1_12rem] truncate">
                  {network.name}
                </Mono>
                {network.internal ? <Badge tone="info">{t('networks.internal')}</Badge> : null}
                <Badge tone={ROLE_TONE[network.role]}>{t(`networks.roles.${network.role}`)}</Badge>
                <span className="w-28 shrink-0 text-right text-xs text-subtle tabular-nums">
                  {t('networks.count', { count: network.containerCount })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
