'use client'

import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusIndicator } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import type { Tone } from '@/lib/tone'
import { useTaskflowCan, useTaskflowProject } from '../../lib/project.tsx'
import { useEnvironment, useEnvironmentServices } from '../../lib/queries/environments.ts'
import type { Environment, EnvironmentExecResponse, EnvironmentService } from '../../lib/types.ts'
import { errorMessage } from '../../lib/utils.ts'

interface EnvironmentPanelProps {
  environmentId: string
  interfaceMode?: 'terminal' | 'web_chat'
  onDestroyed?: () => void
}

function statusTone(status: Environment['status']): Tone {
  if (status === 'ready') return 'ok'
  if (status === 'failed' || status === 'missing') return 'danger'
  if (status === 'awaiting_trust') return 'warn'
  return 'neutral'
}

export function EnvironmentPanel({ environmentId, interfaceMode = 'terminal', onDestroyed }: EnvironmentPanelProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'environment' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const { api, keys } = useTaskflowProject()
  const canOperate = useTaskflowCan('workspace:operate')
  const canTrust = useTaskflowCan('workspace:trust')
  const canExpose = useTaskflowCan('workspace:expose')
  const canAttach = useTaskflowCan('terminal:attach')
  const environmentQuery = useEnvironment(environmentId)
  const servicesQuery = useEnvironmentServices(environmentId)
  const environment = environmentQuery.data ?? null
  const services = servicesQuery.data ?? []
  const [actionError, setActionError] = useState<string | null>(null)
  const loadError = environment
    ? null
    : environmentQuery.error
      ? errorMessage(environmentQuery.error) || t('errors.load')
      : null
  const error = actionError ?? loadError
  const [confirmTrust, setConfirmTrust] = useState(false)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const [command, setCommand] = useState('')
  const [execResult, setExecResult] = useState<EnvironmentExecResponse | null>(null)

  function setServices(next: EnvironmentService[]): void {
    queryClient.setQueryData(keys.environmentServices(environmentId), next)
  }

  async function run(
    work: () => Promise<void>,
    failure: 'action' | 'expose' | 'service' | 'revoke' | 'exec',
  ): Promise<void> {
    setBusy(true)
    try {
      await work()
      setActionError(null)
    } catch (reason: unknown) {
      setActionError(errorMessage(reason) || t(`errors.${failure}`))
    } finally {
      setBusy(false)
    }
  }

  function apply(action: (id: string) => Promise<{ environment: Environment }>): Promise<void> {
    return run(async () => {
      const result = await action(environmentId)
      queryClient.setQueryData(keys.environment(environmentId), result.environment)
      await queryClient.invalidateQueries({ queryKey: keys.environmentServices(environmentId) })
    }, 'action')
  }

  function expose(serviceId: string): Promise<void> {
    return run(
      async () => setServices((await api.exposeEnvironmentService(environmentId, serviceId)).services),
      'expose',
    )
  }

  function controlService(serviceId: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    return run(
      async () => setServices((await api.controlEnvironmentService(environmentId, serviceId, { action })).services),
      'service',
    )
  }

  function revoke(endpointId: string): Promise<void> {
    return run(async () => {
      await api.removeEnvironmentEndpoint(endpointId)
      await queryClient.invalidateQueries({ queryKey: keys.environmentServices(environmentId) })
    }, 'revoke')
  }

  function exec(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const [program, ...args] = command.trim().split(/\s+/).filter(Boolean)
    if (!program) return
    void run(
      async () => setExecResult(await api.runEnvironmentCommand(environmentId, { argv: [program, ...args] })),
      'exec',
    )
  }

  function copyCommand(describe: (id: string) => Promise<{ command: string; args: string[] }>): void {
    void run(async () => {
      const described = await describe(environmentId)
      await navigator.clipboard.writeText([described.command, ...described.args].join(' '))
      toast.push({ tone: 'ok', title: t('commands.copied') })
    }, 'action')
  }

  async function destroy(): Promise<void> {
    setBusy(true)
    try {
      await api.removeEnvironment(environmentId)
      setConfirmDestroy(false)
      onDestroyed?.()
    } catch (reason: unknown) {
      setActionError(errorMessage(reason) || t('errors.destroy'))
    } finally {
      setBusy(false)
    }
  }

  if (!environment) {
    return error ? (
      <section className="rounded-md border border-danger/35 bg-danger/6 p-3 text-sm text-danger">{error}</section>
    ) : (
      <section className="rounded-md border border-line p-3 text-sm text-subtle">{t('loading')}</section>
    )
  }

  const canControlRuntime = environment.provider !== 'host'
  const showRuntimeControls = interfaceMode === 'web_chat'
  const serviceSummary = services
    .flatMap((service) => service.ports.map((port) => `${service.name}:${port.containerPort}`))
    .slice(0, 4)

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-3" aria-label={t('label')}>
      {error ? <p className="rounded-md border border-danger/35 bg-danger/6 p-2 text-xs text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-ink">{t('runtime')}</h3>
          <p className="text-xs text-subtle">
            {environment.provider} <span aria-hidden="true">·</span> {environment.configRef ?? t('hostCommand')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTrust && (!environment.security.trusted || environment.status === 'awaiting_trust') ? (
            <Button size="sm" disabled={busy} variant="primary" onClick={() => setConfirmTrust(true)}>
              {t('reviewConfiguration')}
            </Button>
          ) : null}
          {showRuntimeControls &&
          canOperate &&
          (environment.status === 'stopped' || environment.status === 'detected') ? (
            <Button size="sm" disabled={busy} onClick={() => apply(api.startEnvironment)}>
              {t('actions.start')}
            </Button>
          ) : null}
          {showRuntimeControls && canOperate && environment.status === 'ready' && canControlRuntime ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => apply(api.restartEnvironment)}>
                {t('actions.restart')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => apply(api.stopEnvironment)}>
                {t('actions.stop')}
              </Button>
            </>
          ) : null}
          {showRuntimeControls && canOperate && environment.capabilities.rebuild ? (
            <Button size="sm" disabled={busy} onClick={() => apply(api.rebuildEnvironment)}>
              {t('rebuild')}
            </Button>
          ) : null}
          {showRuntimeControls && canOperate ? (
            <Button size="sm" disabled={busy} variant="danger" onClick={() => setConfirmDestroy(true)}>
              {t('destroy')}
            </Button>
          ) : null}
        </div>
      </div>
      <div role="status">
        <StatusIndicator tone={statusTone(environment.status)}>{t(`status.${environment.status}`)}</StatusIndicator>
      </div>
      {!environment.security.trusted && environment.security.reasons.length > 0 ? (
        <details className="rounded-md border border-warn/35 bg-warn/8 px-3 py-2 text-xs text-warn">
          <summary className="cursor-pointer">{t('reviewAccess')}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {environment.security.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {environment.error ? <p className="text-xs text-danger">{environment.error}</p> : null}
      {environment.runtimeOverride ? (
        <details className="rounded-md bg-surface-2 px-3 py-2 text-xs text-subtle">
          <summary className="cursor-pointer">
            {environment.runtimeOverride.validated ? t('policyValidated') : t('policyUnvalidated')}
          </summary>
          <p className="mt-2">{environment.runtimeOverride.diff.join(', ')}</p>
          {environment.runtimeOverride.diagnostics.map((diagnostic) => (
            <p key={diagnostic}>{diagnostic}</p>
          ))}
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-subtle">
        <span>{services.length === 0 ? t('noServices') : t('serviceCount', { count: services.length })}</span>
        {serviceSummary.map((service) => (
          <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-ink" key={service}>
            {service}
          </span>
        ))}
        {services.length > serviceSummary.length ? <span>+{services.length - serviceSummary.length}</span> : null}
      </div>
      <details className="rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted">{t('servicesAndControls')}</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {services.length === 0 ? (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-subtle">
              {environment.status === 'ready' ? t('noPorts') : t('startToDiscover')}
            </p>
          ) : null}
          {services.map((service) => (
            <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm" key={service.id}>
              <div className="flex justify-between">
                <span>
                  {service.name} <span className="text-subtle">· {service.kind}</span>
                </span>
                <span className="text-subtle">{service.status}</span>
              </div>
              <p className="mt-1 font-mono text-2xs text-subtle">
                {service.ports
                  .map(
                    (port) =>
                      `${port.label ?? port.protocol}:${port.containerPort}${port.hostBinding ? ` → ${port.hostBinding.host}:${port.hostBinding.port}` : ''}`,
                  )
                  .join(' · ') || t('noObservedPorts')}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 font-mono text-xs text-subtle">
                {service.endpoints
                  .filter((endpoint) => endpoint.audiences.includes('user'))
                  .map((endpoint) => (
                    <a
                      className="hover:text-ink"
                      href={endpoint.url}
                      key={endpoint.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {endpoint.url}
                    </a>
                  ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(canOperate ? (service.actions ?? []) : [])
                  .filter((action) => {
                    if (action === 'start') return service.status === 'stopped' || service.status === 'unknown'
                    return (
                      service.status === 'running' || service.status === 'starting' || service.status === 'unhealthy'
                    )
                  })
                  .map((action) => (
                    <Button
                      aria-label={t('serviceActionLabel', { action, service: service.name })}
                      size="xs"
                      disabled={busy}
                      key={action}
                      onClick={() => void controlService(service.id, action)}
                    >
                      {t(`actions.${action}`)}
                    </Button>
                  ))}
                {canExpose &&
                service.status === 'running' &&
                service.ports.length > 0 &&
                !service.endpoints.some((endpoint) => endpoint.audiences.includes('user')) ? (
                  <Button size="xs" disabled={busy} onClick={() => expose(service.id)}>
                    {t('expose')}
                  </Button>
                ) : null}
                {service.endpoints
                  .filter((endpoint) => endpoint.audiences.includes('user'))
                  .map((endpoint) => {
                    const isHttp = endpoint.url.startsWith('http://') || endpoint.url.startsWith('https://')
                    return (
                      <span className="flex gap-1" key={`actions-${endpoint.id}`}>
                        {isHttp ? (
                          <Button size="xs" onClick={() => window.open(endpoint.url, '_blank', 'noopener,noreferrer')}>
                            {tc('open')}
                          </Button>
                        ) : null}
                        <Button size="xs" onClick={() => void navigator.clipboard.writeText(endpoint.url)}>
                          {isHttp ? t('copyUrl') : t('copyAddress')}
                        </Button>
                        {canExpose &&
                        (endpoint.provider === 'local-http' ||
                          endpoint.provider === 'local-forward' ||
                          endpoint.provider === 'local-udp-forward') ? (
                          <Button size="xs" disabled={busy} variant="danger" onClick={() => revoke(endpoint.id)}>
                            {t('revoke')}
                          </Button>
                        ) : null}
                      </span>
                    )
                  })}
              </div>
              <details className="mt-2 text-2xs text-subtle">
                <summary className="cursor-pointer">{tc('details')}</summary>
                <p className="mt-1 break-all">
                  {service.containerIds.length > 0
                    ? t('containers', { ids: service.containerIds.join(', ') })
                    : t('hostService')}
                </p>
                <p>{service.provenance.map((evidence) => `${evidence.source}:${evidence.confidence}`).join(' · ')}</p>
              </details>
            </div>
          ))}
        </div>
      </details>
      <details className="rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted">{t('commands.title')}</summary>
        <div className="mt-2 flex flex-col gap-2">
          {canAttach ? (
            <form className="flex gap-2" onSubmit={exec}>
              <Input
                size="sm"
                mono
                aria-label={t('commands.exec')}
                placeholder={t('commands.execPlaceholder')}
                value={command}
                onChange={(event) => setCommand(event.currentTarget.value)}
              />
              <Button size="sm" type="submit" disabled={busy || command.trim() === ''}>
                {t('commands.run')}
              </Button>
            </form>
          ) : null}
          {execResult ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-2xs whitespace-pre-wrap text-ink scroll-thin">
              {[execResult.stdout, execResult.stderr].filter(Boolean).join('\n')}
              {'\n'}
              <span className="text-subtle">
                {execResult.timedOut
                  ? t('commands.timedOut')
                  : t('commands.exitCode', { code: execResult.code ?? execResult.signal ?? '?' })}
              </span>
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canAttach ? (
              <Button size="xs" disabled={busy} onClick={() => copyCommand(api.fetchEnvironmentTerminal)}>
                {t('commands.copyTerminal')}
              </Button>
            ) : null}
            <Button size="xs" disabled={busy} onClick={() => copyCommand(api.fetchEnvironmentLogs)}>
              {t('commands.copyLogs')}
            </Button>
          </div>
        </div>
      </details>
      <Dialog
        open={confirmTrust}
        onOpenChange={setConfirmTrust}
        title={t('trust.title')}
        description={t('trust.description')}
        footer={
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmTrust(false)}>
              {tc('cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => {
                setConfirmTrust(false)
                void apply(api.trustEnvironment)
              }}
            >
              {t('trust.confirm')}
            </Button>
          </>
        }
      >
        {environment.security.reasons.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-warn">
            {environment.security.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-subtle">{t('trust.noElevated')}</p>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmDestroy}
        onOpenChange={setConfirmDestroy}
        title={t('destroyDialog.title')}
        impact={t('destroyDialog.impact')}
        confirmLabel={t('destroy')}
        busy={busy}
        onConfirm={() => void destroy()}
      />
    </section>
  )
}
