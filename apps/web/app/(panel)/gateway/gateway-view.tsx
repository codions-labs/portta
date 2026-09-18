'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleHelp, RotateCw, Stethoscope, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { DiagnosticText } from '@/components/diagnostic-text'
import { LogViewer } from '@/components/logs'
import { Callout, Empty, ErrorBox, KeyValue, Loading, PageHeader } from '@/components/shell-bits'
import { StateBadge } from '@/components/status'
import { Badge, StatusIndicator } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { api } from '@/lib/api'
import { keys, useGateway } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

const COMPONENTS = ['traefik', 'socket-proxy', 'tailscale', 'db'] as const

export function GatewayView() {
  const { t } = useTranslation('gateway')
  const { t: tc } = useTranslation('common')
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const [component, setComponent] = useState<string>('traefik')
  const [error, setError] = useState<unknown>(null)

  const status = useGateway()

  const doctor = useMutation({
    mutationFn: api.doctor,
    onError: setError,
    onSuccess: () => setError(null),
  })

  const restart = useMutation({
    mutationFn: (components: string[]) => api.restartGateway(components),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  if (status.isPending) return <Loading />
  if (status.error) return <ErrorBox error={status.error} />
  if (!status.data) return null

  const gateway = status.data

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button disabled={doctor.isPending} onClick={() => doctor.mutate()}>
              <Stethoscope />
              {doctor.isPending ? t('checking') : t('runDiagnostics')}
            </Button>
            <Button variant="primary" disabled={restart.isPending} onClick={() => restart.mutate(['traefik'])}>
              <RotateCw className={restart.isPending ? 'animate-spin' : undefined} />
              {t('restartTraefik')}
            </Button>
          </>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      {restart.data ? (
        <Callout tone="info" className="mb-4">
          {t('restarted', {
            components: restart.data.restarted.join(', '),
            note: restart.data.note,
          })}{' '}
          <Mono kind="command" tone="ink">
            {restart.data.applyCommand}
          </Mono>
        </Callout>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('overviewCard.title')} />
          <CardBody>
            <dl className="divide-y divide-line-subtle">
              <KeyValue label={t('overviewCard.profile')}>{gateway.profile}</KeyValue>
              <KeyValue label={t('overviewCard.domain')}>
                <Mono kind="host" tone="ink">
                  {gateway.domain}
                </Mono>
              </KeyValue>
              <KeyValue label={t('overviewCard.listening')}>
                <Mono kind="host" tone="ink">
                  {gateway.bindAddress}:{gateway.httpPort} / {gateway.httpsPort}
                </Mono>
              </KeyValue>
              <KeyValue label={t('overviewCard.tls')}>
                <StatusIndicator tone={gateway.tls.enabled ? 'ok' : 'neutral'} emphasis="ink">
                  {gateway.tls.enabled ? t('overviewCard.tlsEnabled', { mode: gateway.tls.mode }) : tc('disabled')}
                </StatusIndicator>
              </KeyValue>
              <KeyValue label={t('overviewCard.tailscale')}>
                {gateway.tailscale.enabled ? (
                  <StatusIndicator tone={gateway.tailscale.running ? 'ok' : 'warn'} emphasis="ink">
                    {gateway.tailscale.running
                      ? t('overviewCard.tailscaleRunning')
                      : t('overviewCard.tailscaleEnabledNotRunning')}
                  </StatusIndicator>
                ) : (
                  <StatusIndicator tone="neutral" emphasis="ink">
                    {tc('disabled')}
                  </StatusIndicator>
                )}
              </KeyValue>
              <KeyValue label={t('overviewCard.publicAccess')}>
                <StatusIndicator tone={gateway.publicAccess.enabled ? 'warn' : 'neutral'} emphasis="ink">
                  {gateway.publicAccess.enabled ? (gateway.publicAccess.domain ?? tc('enabled')) : tc('disabled')}
                </StatusIndicator>
              </KeyValue>
              <KeyValue label={t('overviewCard.sharedNetwork')}>
                <Mono kind="text" tone="ink">
                  {t('overviewCard.attached', { name: gateway.network.name, count: gateway.network.attached })}
                </Mono>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('components.title')} />
          <CardBody>
            <dl className="divide-y divide-line-subtle">
              <KeyValue label={t('components.traefik')}>
                <StateBadge state={gateway.traefik.state} health={gateway.traefik.health} />
              </KeyValue>
              <KeyValue label={t('components.socketProxy')}>
                <StateBadge state={gateway.socketProxy.state} />
              </KeyValue>
              <KeyValue label={t('components.persistence')}>
                <StateBadge state={gateway.database.state} health={gateway.database.health} />
              </KeyValue>
              <KeyValue label={t('components.tailscale')}>
                {gateway.tailscale.enabled ? (
                  <StatusIndicator tone={gateway.tailscale.running ? 'ok' : 'warn'} emphasis="ink">
                    {gateway.tailscale.running ? tc('running') : t('components.notRunning')}
                  </StatusIndicator>
                ) : (
                  <StatusIndicator tone="neutral" emphasis="ink">
                    {tc('disabled')}
                  </StatusIndicator>
                )}
              </KeyValue>
              <KeyValue label={t('components.sharedNetwork')}>
                <StatusIndicator tone={gateway.network.exists ? 'ok' : 'danger'} emphasis="ink">
                  {gateway.network.exists
                    ? t('components.attached', { count: gateway.network.attached })
                    : t('components.missing')}
                </StatusIndicator>
              </KeyValue>
              <KeyValue label={t('components.routedServices')}>{gateway.routes}</KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('versions.title')} />
          <CardBody>
            <dl className="divide-y divide-line-subtle">
              <KeyValue label={t('versions.gateway')}>{gateway.gatewayVersion}</KeyValue>
              <KeyValue label={t('versions.panel')}>{gateway.panelVersion}</KeyValue>
              <KeyValue label={t('versions.profile')}>{gateway.profile}</KeyValue>
              <KeyValue label={t('versions.domain')}>
                <Mono kind="host" tone="ink">
                  {gateway.domain}
                </Mono>
              </KeyValue>
              <KeyValue label={t('versions.traefikDashboard')}>
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
              <KeyValue label={t('versions.thisPanel')}>
                {!gateway.panel.routed ? (
                  <Badge>{t('versions.loopbackOnly')}</Badge>
                ) : gateway.panel.authenticated ? (
                  <Badge tone="ok">{t('versions.routedForwardAuth')}</Badge>
                ) : (
                  <Badge tone="danger">{t('versions.routedNoCredential')}</Badge>
                )}
                {gateway.panel.readOnly ? <Badge>{t('versions.readOnly')}</Badge> : null}
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('diagnostics.title')}
            description={
              doctor.data
                ? t('diagnostics.summary', {
                    failures: doctor.data.failures,
                    warnings: doctor.data.warnings,
                    time: relativeTime(doctor.data.ranAt),
                  })
                : t('diagnostics.description')
            }
          />
          {doctor.data ? (
            <ul className="max-h-72 divide-y divide-line-subtle overflow-y-auto scroll-thin">
              {doctor.data.checks.map((check) => (
                <li key={check.id} className="flex gap-2 px-3 py-1.5">
                  {check.status === 'pass' ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  ) : check.status === 'info' ? (
                    <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-info" />
                  ) : check.status === 'warn' ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0">
                    <DiagnosticText diagnostic={check} part="title" className="text-xs font-medium text-ink" />
                    <DiagnosticText diagnostic={check} part="detail" className="text-2xs text-muted" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('diagnostics.notRun')} hint={t('diagnostics.notRunHint')} />
          )}
          {doctor.data ? (
            <div className="border-t border-line px-3 py-2 text-2xs text-subtle">
              {t('diagnostics.deeperChecks')}{' '}
              <Mono kind="command" tone="muted">
                {doctor.data.hostCommand}
              </Mono>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t('logs.title')}
          actions={
            <Select
              value={component}
              onChange={(event) => setComponent(event.target.value)}
              size="sm"
              className="w-40"
              aria-label={t('logs.componentAria')}
            >
              {COMPONENTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          }
        />
        <div className="h-96 min-h-0">
          <LogViewer
            queryKey={keys.gatewayLogs(component)}
            load={(tail) => api.gatewayLogs(component, tail)}
            className="h-full"
          />
        </div>
      </Card>
    </>
  )
}
