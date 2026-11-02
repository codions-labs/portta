'use client'

import { ExternalLink, X } from 'lucide-react'
import type { ContainerSummary, Service } from 'portta-contracts'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api/index.ts'
import { orderEndpoints } from '../../lib/endpoints.ts'
import { useCan } from '../../lib/permissions.ts'
import { keys } from '../../lib/queries/index.ts'
import { serviceFromContainer } from '../../lib/services.ts'
import { useFormat } from '../../lib/use-format.ts'
import { ConnectionPanel } from '../connection-panel.tsx'
import { ContainerActions } from '../container-actions.tsx'
import { ContainerConsole } from '../container-console.tsx'
import { Mono } from '../copy.tsx'
import { ExposurePanel } from '../exposure-panel.tsx'
import { LogViewer } from '../logs.tsx'
import { ServiceAlias } from '../service-alias.tsx'
import { ServiceIcon } from '../service-icon.tsx'
import { SharePanel } from '../share-panel.tsx'
import { KeyValue } from '../shell-bits.tsx'
import { StateBadge } from '../status.tsx'
import { TraefikVerdictRow } from '../traefik-verdict.tsx'
import { Button } from '../ui/button.tsx'
import { Drawer } from '../ui/drawer.tsx'
import { EndpointList } from './endpoint-list.tsx'
import { ResourceUsage } from './resource-usage.tsx'
import type { ServiceSection } from './service-row.tsx'

/**
 * One service in the order it is used: open it, decide who may, share it. What
 * it runs on is there for whoever needs it, folded away for whoever does not.
 */
export function ServiceDetails({
  container,
  service = null,
  section = 'overview',
  active = true,
  onClose,
  onLogs,
}: {
  container: ContainerSummary
  service?: Service | null
  section?: ServiceSection
  /** Whether anything is looking at this, so a closed drawer asks Traefik nothing. */
  active?: boolean
  /** Set where this sits beside a list rather than in a drawer that closes itself. */
  onClose?: () => void
  /** Where logs are read when the page has somewhere better than inline. */
  onLogs?: () => void
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
    if (!active) return
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
  }, [active, section])

  const http = container.kind === 'http'
  const running = container.state === 'running'
  const mayConsole = useCan('container:console')
  const route = http ? orderEndpoints(container.urls)[0] : undefined
  const mayShowConsole = mayConsole && container.environment && container.service && running
  const showLogs = () => {
    if (onLogs) {
      onLogs()
      return
    }
    if (logs.current) {
      logs.current.open = true
      logs.current.scrollIntoView()
    }
  }

  return (
    <div className="divide-y divide-line">
      <section aria-label={t('summary')} className="space-y-3 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ServiceIcon tech={container.tech} className="text-ink" />
              <h2 className="text-xl font-semibold text-ink">{row.name}</h2>
              <StateBadge state={container.state} health={container.health} completed={container.completed} />
              {container.uptimeSeconds !== null ? (
                <span className="text-xs text-subtle">{uptime(container.uptimeSeconds)}</span>
              ) : null}
            </div>
          </div>
          {onClose ? (
            <Button variant="ghost" size="icon" aria-label={tc('close')} onClick={onClose}>
              <X />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {route && running ? (
            <Button asChild size="sm" variant="primary">
              <a href={route.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t('openSite')}
              </a>
            </Button>
          ) : null}
          <Button size="sm" onClick={showLogs}>
            {t('logs')}
          </Button>
          {mayShowConsole ? (
            <Button
              size="sm"
              onClick={() => {
                setConsoleOpen(true)
                console.current?.scrollIntoView()
              }}
            >
              {t('console')}
            </Button>
          ) : null}
          <ContainerActions container={container} inPanel />
        </div>
      </section>

      <section ref={access} aria-label={t('access')} className="scroll-mt-4 space-y-2 px-5 py-4">
        <h3 className="text-2xs font-semibold tracking-[0.14em] text-subtle uppercase">
          {http ? t('addresses') : t('access')}
        </h3>
        {http ? (
          container.urls.length > 0 ? (
            <EndpointList endpoints={container.urls} />
          ) : (
            <span className="text-sm text-subtle">{t('noEndpoint')}</span>
          )
        ) : container.environment && container.service && container.exposedPorts.length > 0 ? (
          <ConnectionPanel project={container.environment} service={container.service} />
        ) : (
          <span className="text-sm text-subtle">{t('noEndpoint')}</span>
        )}
        {http && container.environment && running ? (
          <ServiceAlias project={container.environment} service={container} />
        ) : null}
      </section>

      {container.urls.length > 0 ? (
        <>
          <section aria-label={t('whoMayOpen')} className="space-y-2 px-5 py-4">
            <h3 className="text-2xs font-semibold tracking-[0.14em] text-subtle uppercase">{t('whoMayOpen')}</h3>
            <ExposurePanel container={container} />
          </section>
          <section ref={share} aria-label={tc('container.exposure')} className="scroll-mt-4 space-y-2 px-5 py-4">
            <h3 className="text-2xs font-semibold tracking-[0.14em] text-subtle uppercase">
              {tc('container.exposure')}
            </h3>
            <SharePanel container={container} />
          </section>
        </>
      ) : null}

      {onLogs ? null : (
        <details ref={logs} open={section === 'logs'} className="scroll-mt-4 px-5 py-3">
          <summary className="cursor-pointer rounded-xs text-sm font-medium text-ink focus-ring">{t('logs')}</summary>
          <div className="mt-2 h-[40vh] min-h-0">
            <LogViewer
              queryKey={keys.containerLogs(container.id)}
              load={(tail) => api.logs(container.id, tail)}
              className="h-full overflow-hidden rounded-md border border-line"
            />
          </div>
        </details>
      )}

      {mayShowConsole && container.environment && container.service ? (
        <details
          ref={console}
          open={consoleOpen}
          onToggle={(event) => setConsoleOpen(event.currentTarget.open)}
          className="scroll-mt-4 px-5 py-3"
        >
          <summary className="cursor-pointer rounded-xs text-sm font-medium text-ink focus-ring">
            {t('console')}
          </summary>
          <div className="mt-2">
            <ContainerConsole
              environment={container.environment}
              service={container.service}
              enabled={active && consoleOpen}
            />
          </div>
        </details>
      ) : null}

      <details className="px-5 py-3">
        <summary className="cursor-pointer rounded-xs text-sm font-medium text-ink focus-ring">
          {t('technical')}
        </summary>
        <div className="mt-2 space-y-3">
          <dl className="divide-y divide-line-subtle">
            <KeyValue label={tc('container.image')}>
              <Mono value={container.image} />
            </KeyValue>
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
            {container.restartCount > 0 ? (
              <KeyValue label={tc('container.restarts')}>{container.restartCount}</KeyValue>
            ) : null}
            {!running && container.exitCode !== null ? (
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
                <TraefikVerdictRow container={container} enabled={active} />
              </KeyValue>
            ) : null}
          </dl>
          {Object.keys(container.labels).length > 0 ? (
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-2xs text-muted scroll-thin">
              {Object.entries(container.labels).map(([key, value]) => (
                <div key={key} className="break-all">
                  <span className="text-subtle">{key}</span>={value}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )
}

/** The same thing over whatever list opened it, where there is no room beside the list. */
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
  const row = service ?? serviceFromContainer(container)
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={row.name}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {container.tech.label} · {container.image}
          </span>
          {container.environment ? (
            <a
              className="rounded-xs text-link underline-offset-2 hover:underline focus-ring"
              href={`/environments/${encodeURIComponent(container.environment)}`}
            >
              {t('environmentLink')}
            </a>
          ) : null}
        </span>
      }
    >
      <div className="-mx-4 -my-3">
        <ServiceDetails container={container} service={service} section={section} active={open} />
      </div>
    </Drawer>
  )
}
