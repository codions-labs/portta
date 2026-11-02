'use client'

// The services of one environment, and their logs under them: seeing what is
// wrong and reading why happen on the same screen.

import { ChevronRight, ScrollText, TerminalSquare } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ContainerSummary, Service } from 'portta-contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { HostAccess, RouteLine } from '@/components/entities/environment-row'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { ServiceDetails, ServiceDrawer } from '@/components/entities/service-drawer'
import type { ServiceSection } from '@/components/entities/service-row'
import { EnvironmentLogs } from '@/components/environment-logs'
import { canonicalHost } from '@/components/exposure-panel'
import { ServiceIcon } from '@/components/service-icon'
import { Empty, Loading } from '@/components/shell-bits'
import { StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useCan } from '@/lib/permissions'
import { useEnvironment, useEnvironmentServices, useExposure } from '@/lib/queries'
import { serviceRowsFor } from '@/lib/services'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

/** Whether there is room to keep the list beside an open service instead of covering it. */
function useRoomForPanel(): boolean {
  const [room, setRoom] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 1280px)')
    const update = () => setRoom(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return room
}

/** An endpoint as the address it reads as, or nothing when it is not one a browser can open. */
function routeOf(url: string): { url: string; host: string } | undefined {
  try {
    return { url, host: new URL(url).host }
  } catch {
    return undefined
  }
}

function ServiceLine({
  service,
  compact,
  selected,
  filtering,
  onOpen,
  onLogs,
}: {
  service: Service
  /** Beside an open service there is only room for the name and the address. */
  compact: boolean
  selected: boolean
  filtering: boolean
  onOpen: (section?: ServiceSection) => void
  onLogs: () => void
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'servicesTable' })
  const { t: ts } = useTranslation('services')
  const { shortImage } = useFormat()
  const mayRead = useCan('access:read')
  const mayConsole = useCan('container:console')
  const exposure = useExposure(mayRead)
  const running = service.state === 'running'
  const unhealthy = running && service.health === 'unhealthy'
  const primary = service.access.primary
  const http = service.access.kind === 'http'
  const route = primary && http ? routeOf(primary.url) : undefined
  const mode = route
    ? exposure.data?.entries.find((entry) => canonicalHost(entry.host) === canonicalHost(route.host))?.mode
    : undefined

  return (
    <li
      data-service={service.name}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-5 py-2.5 transition-colors duration-100 first:border-t-0',
        selected || filtering ? 'bg-selection' : 'hover:bg-fill',
        service.hidden && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen()}
        aria-label={ts('row.openDrawer', { name: service.name })}
        className={cn('min-w-0 rounded-xs text-left focus-ring', compact ? 'flex-1' : 'flex-[1_1_11rem]')}
      >
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot
            tone={unhealthy ? 'danger' : running ? 'ok' : 'neutral'}
            label={unhealthy ? t('unhealthy') : running ? t('healthy') : t('stopped')}
          />
          <ServiceIcon tech={service.tech} />
          <span className="truncate font-semibold text-ink">{service.name}</span>
        </span>
        <Mono kind="text" tone="subtle" className="mt-0.5 block truncate text-xs" title={service.image}>
          {shortImage(service.image)}
        </Mono>
      </button>

      {compact ? null : (
        <>
          <div className="flex min-w-0 flex-[2_1_16rem] items-center gap-1">
            {route ? (
              <RouteLine route={route} />
            ) : primary ? (
              <Mono kind="text" value={primary.url} className="min-w-0 flex-1 truncate" />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-subtle">
                {running ? t('privateAddress') : t('stopped')}
              </span>
            )}
            {service.access.kind === 'tcp' && running ? (
              <Button size="sm" onClick={() => onOpen('access')}>
                {t('connect')}
              </Button>
            ) : null}
          </div>
          <div className="w-20 shrink-0">
            {route && exposure.data?.enforced ? <HostAccess mode={mode ?? null} /> : null}
          </div>
          <div className="hidden w-36 shrink-0 text-xs text-subtle lg:block">
            {service.resources ? (
              <ResourceUsage
                cpu={service.resources.cpuUtilisation}
                memoryBytes={service.resources.memoryUsedBytes}
                stale={service.resources.stale}
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('filterLogs', { name: service.name })}
              aria-pressed={filtering}
              onClick={onLogs}
            >
              <ScrollText />
            </Button>
            {mayConsole && running ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('openConsole', { name: service.name })}
                onClick={() => onOpen('console')}
              >
                <TerminalSquare />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('details', { name: service.name })}
              onClick={() => onOpen()}
            >
              <ChevronRight />
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

export function EnvironmentOverview({ name }: { name: string }) {
  const { t } = useTranslation('environments')
  const router = useRouter()
  const params = useSearchParams()
  const environmentQuery = useEnvironment(name)
  const served = useEnvironmentServices(name)
  const room = useRoomForPanel()
  const mayReadLogs = useCan('logs:read')
  const [section, setSection] = useState<ServiceSection>('overview')
  const environment = environmentQuery.data
  if (!environment) return <Loading />

  const rows = serviceRowsFor(environment, served.data?.services ?? null)
  const base = `/environments/${encodeURIComponent(name)}`
  const selectedName = params.get('service')
  const logsFor = params.get('logs')
  const service = rows.find((row) => row.name === selectedName) ?? null
  const container: ContainerSummary | null = service
    ? (environment.services.find((candidate) => candidate.id === service.containerId) ?? null)
    : null

  const open = (next: Service, nextSection: ServiceSection = 'overview') => {
    setSection(nextSection)
    router.push(`${base}?service=${encodeURIComponent(next.name)}`)
  }
  const close = () => router.push(base)
  const filterLogs = (next: string | null) => router.push(next ? `${base}?logs=${encodeURIComponent(next)}` : base)

  const list = (compact: boolean) =>
    served.isPending && rows.length === 0 ? (
      <Loading />
    ) : rows.length === 0 ? (
      <Empty
        title={t(environment.presence === 'remembered' ? 'servicesTable.emptyRemembered' : 'servicesTable.empty')}
        hint={environment.presence === 'remembered' ? undefined : t('servicesEmptyHint')}
      />
    ) : (
      <ul>
        {rows.map((row) => (
          <ServiceLine
            key={row.containerId}
            service={row}
            compact={compact}
            selected={row.name === selectedName}
            filtering={row.name === logsFor}
            onOpen={(nextSection) => open(row, nextSection)}
            onLogs={() => filterLogs(row.name === logsFor ? null : row.name)}
          />
        ))}
      </ul>
    )

  if (service && container && room) {
    return (
      <div className="flex items-start gap-4">
        <Card className="w-80 shrink-0">{list(true)}</Card>
        <Card className="min-w-0 flex-1">
          <ServiceDetails
            key={service.containerId}
            container={container}
            service={service}
            section={section}
            onClose={close}
            onLogs={() => filterLogs(service.name)}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {served.error ? <p className="text-sm text-subtle">{t('servicesTable.fallback')}</p> : null}
      <Card>{list(false)}</Card>
      {mayReadLogs && environment.presence !== 'remembered' ? (
        <EnvironmentLogs project={environment} service={logsFor} docked onSelectService={filterLogs} />
      ) : null}
      {service && container ? (
        <ServiceDrawer
          key={service.containerId}
          container={container}
          service={service}
          open
          section={section}
          onOpenChange={(next) => {
            if (!next) close()
          }}
        />
      ) : null}
    </div>
  )
}
