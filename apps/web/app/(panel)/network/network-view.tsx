'use client'

import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { EndpointList } from '@/components/entities/endpoint-list'
import { Empty, ErrorBox, KeyValue, Loading, NoValue, PageHeader } from '@/components/shell-bits'
import { StateBadge } from '@/components/status'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useNetwork } from '@/lib/queries'

const ROLE_TONE = {
  shared: 'accent',
  control: 'info',
  access: 'info',
  project: 'neutral',
  other: 'outline',
} as const

export function NetworkView() {
  const { t } = useTranslation('network')
  const { t: tc } = useTranslation('common')
  const query = useNetwork()

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { domains, routes, networks, tailscale, dns, tls } = query.data

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('domains.title')} />
          <CardBody>
            <dl className="divide-y divide-line-subtle">
              <KeyValue label={t('domains.routedDomain')}>
                <Mono kind="host" tone="ink">
                  {domains.local}
                </Mono>
              </KeyValue>
              <KeyValue label={t('domains.vpnDomain')}>
                {domains.private ? (
                  <Mono kind="host" tone="ink">
                    {domains.private}
                  </Mono>
                ) : (
                  <NoValue />
                )}
              </KeyValue>
              <KeyValue label={t('domains.publicDomain')}>
                {domains.public ? (
                  <Mono kind="host" tone="ink">
                    {domains.public}
                  </Mono>
                ) : (
                  <NoValue />
                )}
              </KeyValue>
              <KeyValue label={t('domains.scheme')}>{domains.scheme}</KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('tls.title')} />
          <CardBody>
            <dl className="divide-y divide-line-subtle">
              <KeyValue label={t('tls.https')}>
                <StatusIndicator tone={tls.enabled ? 'ok' : 'neutral'} emphasis="ink">
                  {tls.enabled ? tc('enabled') : tc('disabled')}
                </StatusIndicator>
              </KeyValue>
              <KeyValue label={t('tls.mode')}>{tls.mode}</KeyValue>
              <KeyValue label={t('tls.acmeContact')}>
                <StatusIndicator tone={tls.acmeEmailSet ? 'ok' : 'warn'} emphasis="ink">
                  {tls.acmeEmailSet ? tc('set') : tc('notSet')}
                </StatusIndicator>
              </KeyValue>
              <KeyValue label={t('tls.directory')}>
                <Mono kind="url" tone="ink" className="break-all whitespace-normal">
                  {tls.caServer}
                </Mono>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('vpnDns.title')} />
          <CardBody>
            <dl className="divide-y divide-line-subtle">
              <KeyValue label={t('vpnDns.tailscale')}>
                {tailscale.enabled ? (
                  <StateBadge state={tailscale.state} health={tailscale.health} />
                ) : (
                  <StatusIndicator tone="neutral" emphasis="ink">
                    {tc('disabled')}
                  </StatusIndicator>
                )}
              </KeyValue>
              <KeyValue label={t('vpnDns.tailnetHostname')}>
                <Mono kind="host" tone="ink">
                  {tailscale.hostname}
                </Mono>
              </KeyValue>
              <KeyValue label={t('vpnDns.dnsProvider')}>{dns.provider}</KeyValue>
              <KeyValue label={t('vpnDns.cloudflare')}>
                <StatusIndicator tone={dns.cloudflareEnabled ? 'ok' : 'neutral'} emphasis="ink">
                  {dns.cloudflareEnabled ? (dns.zone ?? tc('enabled')) : tc('disabled')}
                </StatusIndicator>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('routes.title')} description={t('routes.description')} />
        {routes.length === 0 ? (
          <Empty title={t('routes.empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('routes.project')}</Th>
                <Th>{t('routes.service')}</Th>
                <Th>{t('routes.status')}</Th>
                <Th>{t('routes.targetPort')}</Th>
                <Th>{t('routes.addresses')}</Th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <Tr key={route.containerId}>
                  <Td className="text-xs text-muted">{route.project ?? '-'}</Td>
                  <Td className="font-medium">{route.service ?? route.containerName}</Td>
                  <Td>
                    <StateBadge state={route.state} />
                  </Td>
                  <Td>
                    <Mono kind="port">{route.port}</Mono>
                  </Td>
                  <Td>
                    <EndpointList endpoints={route.urls} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title={t('networks.title')} />
        <Table>
          <thead>
            <tr>
              <Th>{t('networks.name')}</Th>
              <Th>{t('networks.role')}</Th>
              <Th>{t('networks.driver')}</Th>
              <Th>{t('networks.containers')}</Th>
              <Th>{t('networks.flags')}</Th>
            </tr>
          </thead>
          <tbody>
            {networks.map((network) => (
              <Tr key={network.id}>
                <Td>
                  <Mono kind="host" tone="ink">
                    {network.name}
                  </Mono>
                </Td>
                <Td>
                  <Badge tone={ROLE_TONE[network.role]}>{t(`networks.roles.${network.role}`)}</Badge>
                </Td>
                <Td className="text-xs text-muted">{network.driver}</Td>
                <Td className="text-xs tabular-nums">{network.containerCount}</Td>
                <Td>
                  <span className="flex gap-1">
                    {network.internal ? <Badge tone="info">{t('networks.internal')}</Badge> : null}
                    {network.managed ? <Badge tone="accent">{t('networks.gateway')}</Badge> : null}
                  </span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  )
}
