'use client'

// The pieces that make every address on this machine work, and what they are
// saying. Restarting and diagnosing live in the Host header, on every tab.

import type { ContainerSummary, GatewayStatus } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { LogViewer } from '@/components/logs'
import { Disclosure, ErrorBox, FilterChip, KeyValue, Loading } from '@/components/shell-bits'
import { containerTone, StateBadge } from '@/components/status'
import { Badge, StatusDot, StatusIndicator } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useContainers, useGateway } from '@/lib/queries'
import { narrowTone } from '@/lib/tone'
import { cn } from '@/lib/utils'

const LOG_SOURCES = ['traefik', 'socket-proxy', 'tailscale', 'db'] as const

/** The tag of an image, which is as close to a version as a running container says. */
function versionOf(container: ContainerSummary | undefined): string | null {
  const tag = container?.image.split(':')[1]
  return tag && tag !== 'latest' ? tag : null
}

function Part({
  name,
  tone,
  version,
  state,
}: {
  name: string
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  version: string | null
  state: string
}) {
  return (
    <Card className="px-5 py-4">
      <span className="flex items-center gap-2 font-semibold text-ink">
        <StatusDot tone={tone} label={state} />
        {name}
      </span>
      <span className={cn('mt-0.5 block text-xs text-muted', !version && 'first-letter:uppercase')}>
        {[version, state].filter(Boolean).join(' · ')}
      </span>
    </Card>
  )
}

function Details({ gateway }: { gateway: GatewayStatus }) {
  const { t } = useTranslation('gateway')
  const { t: tc } = useTranslation('common')
  return (
    <Disclosure title={t('details.title')}>
      <dl className="divide-y divide-line-subtle">
        <KeyValue label={t('details.listening')}>
          <Mono kind="host" tone="ink">
            {gateway.bindAddress}:{gateway.httpPort} / {gateway.httpsPort}
          </Mono>
        </KeyValue>
        <KeyValue label={t('details.sharedNetwork')}>
          <StatusIndicator tone={gateway.network.exists ? 'ok' : 'danger'} emphasis="ink">
            {gateway.network.exists
              ? t('details.attached', { name: gateway.network.name, count: gateway.network.attached })
              : t('details.missing', { name: gateway.network.name })}
          </StatusIndicator>
        </KeyValue>
        <KeyValue label={t('details.routedServices')}>{gateway.routes}</KeyValue>
        <KeyValue label={t('details.persistence')}>
          <StateBadge state={gateway.database.state} health={gateway.database.health} />
        </KeyValue>
        <KeyValue label={t('details.publicAccess')}>
          <StatusIndicator tone={gateway.publicAccess.enabled ? 'warn' : 'neutral'} emphasis="ink">
            {gateway.publicAccess.enabled ? (gateway.publicAccess.domain ?? tc('enabled')) : tc('disabled')}
          </StatusIndicator>
        </KeyValue>
        <KeyValue label={t('details.traefikDashboard')}>
          {gateway.dashboard.enabled ? (
            <Mono kind="host" tone="ink">
              {gateway.dashboard.bindAddress}:{gateway.dashboard.port}
            </Mono>
          ) : (
            <StatusIndicator tone="neutral" emphasis="ink">
              {tc('disabled')}
            </StatusIndicator>
          )}
        </KeyValue>
        <KeyValue label={t('details.thisPanel')}>
          {!gateway.panel.routed ? (
            <Badge>{t('details.loopbackOnly')}</Badge>
          ) : gateway.panel.authenticated ? (
            <Badge tone="ok">{t('details.routedForwardAuth')}</Badge>
          ) : (
            <Badge tone="danger">{t('details.routedNoCredential')}</Badge>
          )}
          {gateway.panel.readOnly ? <Badge className="ml-1">{t('details.readOnly')}</Badge> : null}
        </KeyValue>
      </dl>
    </Disclosure>
  )
}

export function GatewayView() {
  const { t } = useTranslation('gateway')
  const { t: tc } = useTranslation('common')
  const [source, setSource] = useState<(typeof LOG_SOURCES)[number]>('traefik')
  const status = useGateway()
  const containers = useContainers({}, useCan('docker:read'))

  if (status.isPending) return <Loading />
  if (status.error) return <ErrorBox error={status.error} />
  if (!status.data) return null

  const gateway = status.data
  const all = containers.data?.containers ?? []
  const byId = (id: string | null) => all.find((container) => container.id === id)
  const auth = all.find((container) => container.service === 'portta-auth')
  const word = (state: string, health?: string) =>
    health && health !== 'none' && state === 'running'
      ? tc(`health.${health}`, { defaultValue: health })
      : tc(`state.${state}`, { defaultValue: state })
  const toneOf = (state: GatewayStatus['traefik']['state'], health?: GatewayStatus['traefik']['health']) =>
    narrowTone(containerTone(state, health)) as 'ok' | 'warn' | 'danger' | 'neutral'

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Part
          name={t('parts.traefik')}
          tone={toneOf(gateway.traefik.state, gateway.traefik.health)}
          version={versionOf(byId(gateway.traefik.containerId))}
          state={word(gateway.traefik.state, gateway.traefik.health)}
        />
        <Part
          name={t('parts.socketProxy')}
          tone={toneOf(gateway.socketProxy.state)}
          version={versionOf(byId(gateway.socketProxy.containerId))}
          state={word(gateway.socketProxy.state)}
        />
        <Part
          name={t('parts.auth')}
          tone={auth ? toneOf(auth.state, auth.health) : 'neutral'}
          version={versionOf(auth)}
          state={auth ? word(auth.state, auth.health) : tc('disabled')}
        />
        <Part
          name={t('parts.tailscale')}
          tone={gateway.tailscale.enabled ? (gateway.tailscale.running ? 'ok' : 'warn') : 'neutral'}
          version={null}
          state={
            gateway.tailscale.enabled
              ? gateway.tailscale.running
                ? tc('running')
                : t('parts.notRunning')
              : tc('disabled')
          }
        />
      </div>

      <Card className="flex h-96 min-h-0 flex-col overflow-hidden">
        <LogViewer
          docked
          className="min-h-0 flex-1"
          queryKey={keys.gatewayLogs(source)}
          load={(tail) => api.gatewayLogs(source, tail)}
          chips={
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('logs.componentAria')}>
              {LOG_SOURCES.map((name) => (
                <FilterChip key={name} active={source === name} onClick={() => setSource(name)}>
                  {t(`logs.sources.${name}`)}
                </FilterChip>
              ))}
            </div>
          }
        />
      </Card>

      <Details gateway={gateway} />
    </div>
  )
}
