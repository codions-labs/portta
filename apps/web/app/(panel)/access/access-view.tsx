'use client'

// Databases and everything else that speaks TCP. They stay private; Connect opens
// a bridge on this machine, and what it takes to use it appears under the row.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plug } from 'lucide-react'
import type { Bridge, TcpService } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MaskedSecret } from '@/components/connection-panel'
import { CopyButton, Mono } from '@/components/copy'
import { ServiceIcon } from '@/components/service-icon'
import { Empty, ErrorBox, FilterChip, Loading, ViewToolbar } from '@/components/shell-bits'
import { StateBadge } from '@/components/status'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useAccess, useServiceConnection } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

function Block({
  label,
  value,
  copyLabel,
  children,
}: {
  label: string
  value?: string
  copyLabel?: string
  children?: React.ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-2xs font-semibold tracking-[0.14em] text-muted uppercase">{label}</p>
      {value ? (
        <div className="flex items-center gap-1 rounded-md bg-terminal py-1 pr-1 pl-3 text-terminal-fg">
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
            {value}
          </span>
          <CopyButton value={value} label={copyLabel} className="text-terminal-dim hover:text-terminal-fg" />
        </div>
      ) : null}
      {children ? <div className="text-xs text-muted">{children}</div> : null}
    </div>
  )
}

function FixedAddress({ service, enabled }: { service: TcpService; enabled: boolean }) {
  const { t } = useTranslation('access')
  if (service.gatewayAddress) {
    return (
      <Block label={t('tcp.fixed')} value={service.gatewayAddress} copyLabel={t('services.copyAddress')}>
        {service.routing === 'tls-sni' ? t('services.tlsRequiredHostname') : t('services.tlsRequiredSslmode')}
      </Block>
    )
  }
  return (
    <Block label={t('tcp.fixed')}>
      {service.routing === 'unsupported'
        ? t('services.serverSpeaksFirst')
        : service.routing === 'unevaluated'
          ? t('services.notEvaluated')
          : enabled
            ? t('tcp.notOptedIn')
            : t('tcp.routingOff')}
    </Block>
  )
}

/** What it takes to use an open bridge: where it listens, the text to paste, and the password if it can be known. */
function Connected({ service, bridge, routing }: { service: TcpService; bridge: Bridge; routing: boolean }) {
  const { t } = useTranslation('access')
  const { expiresIn } = useFormat()
  const connection = useServiceConnection(service.project, service.service, true)
  const credentials = connection.data?.credentials
  return (
    <div className="grid gap-4 bg-surface-2 px-5 py-4 md:grid-cols-3">
      <Block
        label={t('tcp.bridge')}
        value={`${bridge.bindIp}:${bridge.localPort ?? '?'}`}
        copyLabel={t('tcp.copyBridge')}
      >
        {bridge.expiresAt ? t('tcp.expires', { time: expiresIn(bridge.expiresAt) }) : t('tcp.noExpiry')}
      </Block>
      <Block
        label={t('tcp.connectionText')}
        value={bridge.connectionString}
        copyLabel={t('bridges.copyConnectionString')}
      >
        {credentials?.discovered && credentials.password ? (
          <span className="inline-flex items-center gap-1.5">
            {t('connection.password')}
            <MaskedSecret
              value={credentials.password}
              revealLabel={t('connection.revealPassword')}
              hideLabel={t('connection.hidePassword')}
              copyLabel={t('connection.copyPassword')}
            />
          </span>
        ) : (
          t('tcp.passwordFromProject')
        )}
      </Block>
      <FixedAddress service={service} enabled={routing} />
    </div>
  )
}

export function AccessView() {
  const { t } = useTranslation('access')
  const { shortImage } = useFormat()
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [filter, setFilter] = useState<string>('all')
  const query = useAccess()

  const open = useMutation({
    mutationFn: (service: TcpService) => api.openBridge({ project: service.project, service: service.service }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  const close = useMutation({
    mutationFn: (bridge: Bridge) => api.closeBridge(bridge.id),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { services, bridges, forwarders, tcpRoutingEnabled } = query.data
  // A bridge whose service is gone still holds a port, and still has to be closable.
  const known = new Set(services.flatMap((service) => (service.bridge ? [service.bridge.id] : [])))
  const orphans = bridges.filter((bridge) => !known.has(bridge.id))
  const kinds = [...new Set(services.map((service) => service.tech.label))].sort()
  const connected = services.filter((service) => service.bridge).length
  const shown = services.filter(
    (service) => filter === 'all' || (filter === 'connected' ? Boolean(service.bridge) : service.tech.label === filter),
  )

  return (
    <>
      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      <ViewToolbar>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('tcp.all', { count: services.length })}
        </FilterChip>
        {connected > 0 ? (
          <FilterChip active={filter === 'connected'} onClick={() => setFilter('connected')}>
            <StatusDot tone="ok" label={t('tcp.connected', { count: connected })} />
            {t('tcp.connected', { count: connected })}
          </FilterChip>
        ) : null}
        {kinds.map((kind) => (
          <FilterChip key={kind} active={filter === kind} onClick={() => setFilter(kind)}>
            {kind} {services.filter((service) => service.tech.label === kind).length}
          </FilterChip>
        ))}
      </ViewToolbar>

      {orphans.length > 0 ? (
        <Card className="mb-4">
          <CardHeader title={t('bridges.title')} description={t('tcp.orphans')} />
          <ul>
            {orphans.map((bridge) => (
              <li
                key={bridge.id}
                className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-2.5 first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                  {bridge.project}
                  <span className="font-normal text-muted"> / {bridge.service}</span>
                </span>
                <Mono kind="host">
                  {bridge.bindIp}:{bridge.localPort ?? '?'}
                </Mono>
                <CopyButton value={bridge.connectionString} label={t('bridges.copyConnectionString')} />
                <Button size="sm" disabled={close.isPending} onClick={() => close.mutate(bridge)}>
                  {t('bridges.close')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        {shown.length === 0 ? (
          <Empty title={t('services.empty')} />
        ) : (
          <ul aria-label={t('services.aria')}>
            {shown.map((service) => (
              <li key={service.containerId} className="border-t border-line first:border-t-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5">
                  <div className="min-w-0 flex-[1_1_13rem]">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      <ServiceIcon tech={service.tech} />
                      <span className="truncate">{service.service}</span>
                    </span>
                    <span className="block truncate text-xs text-subtle">{service.project}</span>
                  </div>
                  <div className="w-24 shrink-0">
                    <Badge>{service.tech.label}</Badge>
                  </div>
                  <Mono
                    kind="text"
                    tone="subtle"
                    className="min-w-0 flex-[1_1_10rem] truncate text-xs"
                    title={service.image}
                  >
                    {shortImage(service.image)}
                  </Mono>
                  <div className="flex min-w-0 flex-[1_1_11rem] items-center gap-2 text-sm">
                    {service.bridge ? (
                      <>
                        <StatusDot tone="ok" label={t('tcp.bridge')} />
                        <Mono kind="host" tone="ink" className="truncate">
                          {service.bridge.bindIp}:{service.bridge.localPort ?? '?'}
                        </Mono>
                      </>
                    ) : service.state === 'running' ? (
                      <span className="text-subtle">{t('tcp.private')}</span>
                    ) : (
                      <StateBadge state={service.state} health={service.health} />
                    )}
                  </div>
                  <div className="w-28 shrink-0 text-right">
                    {service.bridge ? (
                      <Button
                        size="sm"
                        disabled={close.isPending}
                        onClick={() => service.bridge && close.mutate(service.bridge)}
                      >
                        {t('tcp.closeBridge')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={service.state !== 'running' || open.isPending}
                        aria-label={t('tcp.connectTo', { name: `${service.project}/${service.service}` })}
                        onClick={() => open.mutate(service)}
                      >
                        {t('tcp.connect')}
                      </Button>
                    )}
                  </div>
                </div>
                {service.bridge ? (
                  <Connected service={service} bridge={service.bridge} routing={tcpRoutingEnabled} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {forwarders.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title={t('forwarders.title')} description={t('forwarders.description')} />
          <Table aria-label={t('forwarders.aria')}>
            <thead>
              <tr>
                <Th>{t('forwarders.alias')}</Th>
                <Th>{t('forwarders.service')}</Th>
                <Th>{t('forwarders.port')}</Th>
                <Th>{t('forwarders.status')}</Th>
                <Th>{t('forwarders.networks')}</Th>
              </tr>
            </thead>
            <tbody>
              {forwarders.map((forwarder) => (
                <Tr key={forwarder.alias}>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <Plug className="size-3.5 text-subtle" />
                      <Mono kind="host" tone="ink">
                        {forwarder.alias}
                      </Mono>
                    </span>
                  </Td>
                  <Td className="text-xs">
                    {forwarder.project}/{forwarder.service}
                  </Td>
                  <Td>
                    <Mono kind="port" tone="ink">
                      {forwarder.port}
                    </Mono>
                  </Td>
                  <Td>
                    <StateBadge state={forwarder.state} />
                  </Td>
                  <Td>
                    <Mono kind="text" tone="subtle">
                      {forwarder.networks.join(', ')}
                    </Mono>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  )
}
