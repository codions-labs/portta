'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plug, PlugZap, X } from 'lucide-react'
import type { Bridge, TcpService } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionPanel } from '@/components/connection-panel'
import { CopyButton, Mono } from '@/components/copy'
import { ServiceIcon } from '@/components/service-icon'
import { Empty, ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { StateBadge } from '@/components/status'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useAccess } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

function GatewayAddress({ service, enabled }: { service: TcpService; enabled: boolean }) {
  const { t } = useTranslation('access')
  const { gatewayAddress, gatewayConnectionString, routing } = service

  if (gatewayAddress) {
    return (
      <div>
        <div className="flex items-center gap-1">
          <Mono kind="host" tone="ink" className="text-xs">
            {gatewayAddress}
          </Mono>
          <CopyButton value={gatewayAddress} label={t('services.copyAddress')} />
          {gatewayConnectionString ? (
            <CopyButton value={gatewayConnectionString} label={t('services.copyGatewayConnectionString')} />
          ) : null}
        </div>
        <div className="text-2xs text-subtle">
          {routing === 'tls-sni' ? t('services.tlsRequiredHostname') : t('services.tlsRequiredSslmode')}
        </div>
      </div>
    )
  }

  if (routing === 'unsupported') {
    return (
      <div>
        <Badge tone="neutral">{t('services.noHostnameSharing')}</Badge>
        <div className="text-2xs text-subtle">{t('services.serverSpeaksFirst')}</div>
      </div>
    )
  }

  if (routing === 'unevaluated') {
    return <span className="text-xs text-subtle">{t('services.notEvaluated')}</span>
  }

  return (
    <div>
      <span className="text-xs text-subtle">{enabled ? t('services.notOptedIn') : t('services.routingOff')}</span>
      <div className="text-2xs text-subtle">{enabled ? t('services.addTcpOverlay') : t('services.tcpDisabled')}</div>
    </div>
  )
}

export function AccessView() {
  const { t } = useTranslation('access')
  const { expiresIn, shortImage } = useFormat()
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)
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

  const { services, bridges, forwarders } = query.data

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      <Card>
        <CardHeader title={t('bridges.title')} description={t('bridges.description')} />
        {bridges.length === 0 ? (
          <Empty title={t('bridges.empty')} hint={t('bridges.emptyHint')} />
        ) : (
          <Table aria-label={t('bridges.aria')}>
            <thead>
              <tr>
                <Th>{t('bridges.service')}</Th>
                <Th>{t('bridges.localAddress')}</Th>
                <Th>{t('bridges.connectionString')}</Th>
                <Th>{t('bridges.expires')}</Th>
                <Th className="text-right">{t('bridges.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {bridges.map((bridge) => (
                <Tr key={bridge.id}>
                  <Td>
                    <div className="font-medium">
                      {bridge.project}
                      <span className="text-muted">/{bridge.service}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge tone="info">{bridge.kind}</Badge>
                      <StateBadge state={bridge.state} />
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Mono kind="host" tone="ink" className="text-xs">
                        {bridge.bindIp}:{bridge.localPort ?? '?'}
                      </Mono>
                      <CopyButton value={bridge.bindIp} label={t('bridges.copyHost')} />
                      <CopyButton value={String(bridge.localPort ?? '')} label={t('bridges.copyPort')} />
                    </div>
                    <div className="text-2xs text-subtle">
                      {t('bridges.target', { service: bridge.service, port: bridge.targetPort })}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Mono kind="url" className="max-w-64 text-xs">
                        {bridge.connectionString}
                      </Mono>
                      <CopyButton value={bridge.connectionString} label={t('bridges.copyConnectionString')} />
                    </div>
                    <div className="text-2xs text-subtle">{t('bridges.credentialsHint')}</div>
                  </Td>
                  <Td className="text-xs text-muted">{expiresIn(bridge.expiresAt)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="danger" disabled={close.isPending} onClick={() => close.mutate(bridge)}>
                      <X />
                      {t('bridges.close')}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title={t('services.title')}
          description={
            query.data.tcpRoutingEnabled ? t('services.descriptionEnabled') : t('services.descriptionDisabled')
          }
        />
        {services.length === 0 ? (
          <Empty title={t('services.empty')} />
        ) : (
          <Table aria-label={t('services.aria')}>
            <thead>
              <tr>
                <Th>{t('services.project')}</Th>
                <Th>{t('services.service')}</Th>
                <Th>{t('services.kind')}</Th>
                <Th>{t('services.image')}</Th>
                <Th>{t('services.port')}</Th>
                <Th>{t('services.status')}</Th>
                <Th>{t('services.gatewayAddress')}</Th>
                <Th className="text-right">{t('services.localAccess')}</Th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <Tr key={service.containerId}>
                  <Td className="text-xs text-muted">{service.project}</Td>
                  <Td>
                    <span className="flex items-center gap-1.5 font-medium">
                      <ServiceIcon tech={service.tech} />
                      {service.service}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={service.kind === 'tcp' ? 'neutral' : 'info'}>{service.kind}</Badge>
                  </Td>
                  <Td>
                    <Mono kind="text" title={service.image}>
                      {shortImage(service.image)}
                    </Mono>
                  </Td>
                  <Td>
                    <Mono kind="port">{service.defaultPort ?? service.ports[0] ?? '-'}</Mono>
                  </Td>
                  <Td>
                    <StateBadge state={service.state} health={service.health} />
                  </Td>
                  <Td>
                    <GatewayAddress service={service} enabled={query.data.tcpRoutingEnabled} />
                    <ConnectionPanel project={service.project} service={service.service} />
                  </Td>
                  <Td className="text-right">
                    {service.bridge ? (
                      <StatusIndicator tone="ok" emphasis="ink" className="justify-end">
                        <Mono kind="host" tone="ink">
                          {service.bridge.bindIp}:{service.bridge.localPort}
                        </Mono>
                      </StatusIndicator>
                    ) : (
                      <Button
                        size="sm"
                        disabled={service.state !== 'running' || open.isPending}
                        onClick={() => open.mutate(service)}
                      >
                        <PlugZap />
                        {t('services.openLocalAccess')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title={t('forwarders.title')} description={t('forwarders.description')} />
        {forwarders.length === 0 ? (
          <Empty title={t('forwarders.empty')} hint={t('forwarders.emptyHint')} />
        ) : (
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
        )}
      </Card>
    </>
  )
}
