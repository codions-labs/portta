'use client'

import type { ContainerSummary, Service } from 'portta-contracts'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api/index.ts'
import { useCan } from '../../lib/permissions.ts'
import { keys } from '../../lib/queries/index.ts'
import { serviceFromContainer } from '../../lib/services.ts'
import { useFormat } from '../../lib/use-format.ts'
import { ConnectionPanel } from '../connection-panel.tsx'
import { ContainerActions } from '../container-actions.tsx'
import { ContainerConsole } from '../container-console.tsx'
import { Mono } from '../copy.tsx'
import { LogViewer } from '../logs.tsx'
import { ServiceAlias } from '../service-alias.tsx'
import { ServiceIcon } from '../service-icon.tsx'
import { SharePanel } from '../share-panel.tsx'
import { KeyValue, SectionHeader } from '../shell-bits.tsx'
import { OwnershipBadge, StateBadge } from '../status.tsx'
import { TraefikVerdictRow } from '../traefik-verdict.tsx'
import { Drawer } from '../ui/drawer.tsx'
import { EndpointList } from './endpoint-list.tsx'
import { OpenTestMenu } from './open-test-menu.tsx'
import { ResourceUsage } from './resource-usage.tsx'
import type { ServiceSection } from './service-row.tsx'

/**
 * Everything about one service, beside the list it came from: access,
 * measurement, the container underneath, Traefik's verdict, sharing, the
 * alias, and its logs. The row is the summary; this is the rest.
 */
export function ServiceDrawer({
  container,
  service = null,
  open,
  onOpenChange,
  section = 'overview',
}: {
  container: ContainerSummary
  service?: Service | null
  open: boolean
  onOpenChange: (open: boolean) => void
  section?: ServiceSection
}) {
  const { t } = useTranslation('services', { keyPrefix: 'drawer' })
  const { t: tc } = useTranslation('common')
  const { relativeTime, shortId, uptime } = useFormat()
  const row = service ?? serviceFromContainer(container)
  const logs = useRef<HTMLDetailsElement>(null)
  const console = useRef<HTMLDetailsElement>(null)
  const [consoleOpen, setConsoleOpen] = useState(section === 'console')
  const share = useRef<HTMLDivElement>(null)
  const access = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const target =
      section === 'logs'
        ? logs.current
        : section === 'console'
          ? console.current
          : section === 'share'
            ? share.current
            : section === 'access'
              ? access.current
              : null
    if (target && 'open' in target) (target as HTMLDetailsElement).open = true
    if (section === 'console') setConsoleOpen(true)
    target?.scrollIntoView?.({ block: 'start' })
  }, [open, section])

  const http = container.kind === 'http'
  const mayConsole = useCan('container:console')

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <ServiceIcon tech={container.tech} className="text-ink" />
          <span>{row.name}</span>
          <StateBadge state={container.state} health={container.health} completed={container.completed} />
          <OwnershipBadge ownership={container.ownership} />
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {container.tech.label} · {container.image}
          </span>
          {container.environment ? (
            <a
              className="rounded-xs text-accent underline-offset-2 hover:underline focus-ring"
              href={`/environments/${encodeURIComponent(container.environment)}`}
            >
              {t('environmentLink')}
            </a>
          ) : null}
        </span>
      }
      footer={
        <>
          {container.state === 'running' && (row.access.endpoints.length > 0 || row.access.kind === 'tcp') ? (
            <OpenTestMenu
              service={row}
              onLogs={() => {
                if (logs.current) {
                  logs.current.open = true
                  logs.current.scrollIntoView()
                }
              }}
            />
          ) : null}
          <ContainerActions container={container} />
        </>
      }
    >
      <div className="space-y-4">
        <section aria-label={t('summary')}>
          <dl className="divide-y divide-line-subtle">
            <KeyValue label={tc('container.containerId')}>
              <Mono value={shortId(container.id)} />
            </KeyValue>
            {container.environment ? (
              <KeyValue label={tc('container.composeProject')}>
                {container.environment}
                {container.service ? <span className="text-muted"> · {container.service}</span> : null}
              </KeyValue>
            ) : null}
            {container.workingDir ? (
              <KeyValue label={tc('container.workingDirectory')}>
                <Mono value={container.workingDir} />
              </KeyValue>
            ) : null}
            <KeyValue label={tc('container.uptime')}>{uptime(container.uptimeSeconds)}</KeyValue>
            {container.restartCount > 0 ? (
              <KeyValue label={tc('container.restarts')}>{container.restartCount}</KeyValue>
            ) : null}
            {container.state !== 'running' && container.exitCode !== null ? (
              <KeyValue label={tc('container.exitCode')}>{container.exitCode}</KeyValue>
            ) : null}
            {row.resources ? (
              <KeyValue label={tc('container.resources')}>
                <ResourceUsage
                  variant="bar"
                  cpu={row.resources.cpuUtilisation}
                  memoryBytes={row.resources.memoryUsedBytes}
                  memoryLimitBytes={row.resources.memoryLimitBytes}
                  diskBytes={row.resources.diskBytes}
                  stale={row.resources.stale}
                />
                {row.resources.collectedAt ? (
                  <div className="mt-1 text-2xs text-subtle">
                    {t('measuredAt', { time: relativeTime(row.resources.collectedAt) })}
                  </div>
                ) : null}
              </KeyValue>
            ) : null}
          </dl>
        </section>

        <section ref={access} aria-label={t('access')} className="scroll-mt-4">
          <SectionHeader as="h3" title={t('access')} className="mb-1" />
          {http ? (
            container.urls.length > 0 ? (
              <EndpointList endpoints={container.urls} />
            ) : (
              <span className="text-xs text-subtle">{t('noEndpoint')}</span>
            )
          ) : container.environment && container.service && container.exposedPorts.length > 0 ? (
            <ConnectionPanel project={container.environment} service={container.service} />
          ) : (
            <span className="text-xs text-subtle">{t('noEndpoint')}</span>
          )}
        </section>

        <section aria-label={t('runtime')}>
          <SectionHeader as="h3" title={t('runtime')} className="mb-1" />
          <dl className="divide-y divide-line-subtle">
            <KeyValue label={tc('container.networks')}>
              <Mono kind="text">{container.networks.length ? container.networks.join(', ') : tc('none')}</Mono>
            </KeyValue>
            {container.exposedPorts.length > 0 ? (
              <KeyValue label={tc('container.containerPorts')}>
                <Mono value={container.exposedPorts.join(', ')} />
              </KeyValue>
            ) : null}
            {container.ports.length > 0 ? (
              <KeyValue label={tc('container.publishedPorts')}>
                <div className="space-y-0.5 font-mono text-xs text-muted">
                  {container.ports.map((port) => (
                    <div key={`${port.ip}:${port.hostPort}`}>
                      {port.ip}:{port.hostPort} → {port.containerPort}/{port.protocol}
                    </div>
                  ))}
                </div>
              </KeyValue>
            ) : null}
            {container.mounts.length > 0 ? (
              <KeyValue label={tc('container.mounts')}>
                <div className="space-y-0.5 font-mono text-xs text-muted">
                  {container.mounts.map((mount) => (
                    <div key={mount.destination}>
                      {mount.type}: {mount.name ?? mount.source} → {mount.destination}
                      {mount.rw ? '' : ' (ro)'}
                    </div>
                  ))}
                </div>
              </KeyValue>
            ) : null}
            {container.urls.length > 0 ? (
              <KeyValue label={tc('container.traefik')}>
                <TraefikVerdictRow container={container} enabled={open} />
              </KeyValue>
            ) : null}
            {http && container.environment && container.state === 'running' ? (
              <KeyValue label={tc('container.hostnameAlias')}>
                <ServiceAlias project={container.environment} service={container} />
              </KeyValue>
            ) : null}
          </dl>
        </section>

        {container.urls.length > 0 ? (
          <section ref={share} aria-label={tc('container.exposure')} className="scroll-mt-4">
            <SectionHeader as="h3" title={tc('container.exposure')} className="mb-1" />
            <SharePanel container={container} />
          </section>
        ) : null}

        <details ref={logs} open={section === 'logs'} className="scroll-mt-4">
          <summary className="cursor-pointer rounded-xs text-sm font-medium text-ink focus-ring">{t('logs')}</summary>
          <div className="mt-2 h-[40vh] min-h-0">
            <LogViewer
              queryKey={keys.containerLogs(container.id)}
              load={(tail) => api.logs(container.id, tail)}
              className="h-full rounded-md border border-line"
            />
          </div>
        </details>

        {mayConsole && container.environment && container.service && container.state === 'running' ? (
          <details
            ref={console}
            open={consoleOpen}
            onToggle={(event) => setConsoleOpen(event.currentTarget.open)}
            className="scroll-mt-4"
          >
            <summary className="cursor-pointer rounded-xs text-sm font-medium text-ink focus-ring">
              {t('console')}
            </summary>
            <div className="mt-2">
              <ContainerConsole
                environment={container.environment}
                service={container.service}
                enabled={open && consoleOpen}
              />
            </div>
          </details>
        ) : null}

        {Object.keys(container.labels).length > 0 ? (
          <details>
            <summary className="cursor-pointer rounded-xs text-sm font-medium text-ink focus-ring">
              {t('labels')}
            </summary>
            <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-2xs text-muted scroll-thin">
              {Object.entries(container.labels).map(([key, value]) => (
                <div key={key} className="break-all">
                  <span className="text-subtle">{key}</span>={value}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </Drawer>
  )
}
