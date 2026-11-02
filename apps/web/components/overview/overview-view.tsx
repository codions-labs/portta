'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, CircleDot, Layers, Plus, ShieldCheck, XCircle } from 'lucide-react'
import Link from 'next/link'
import type { AttentionItem, DevelopmentOverview, HostPressure, Overview } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { DiagnosticText } from '@/components/diagnostic-text'
import { HostAccess, primaryRoute, RouteLine } from '@/components/entities/environment-row'
import { canonicalHost } from '@/components/exposure-panel'
import { HostHeader, HostReadings, HostSummarySkeleton, pressureReasons } from '@/components/host-summary'
import { Empty, ErrorBox, Loading, MetricCard, PageHeader } from '@/components/shell-bits'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ApiError, api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import {
  useAccess,
  useClosedHosts,
  useDevelopmentOverview,
  useEnvironmentOwners,
  useEnvironments,
  useExposure,
  useMetricsCurrent,
  useMetricsHistory,
  useShares,
  useStatus,
} from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

/**
 * What a person asks when they open the panel, in that order: is everything
 * fine, what needs me, and where is the thing I came to open. The machine
 * itself has its own page, Host.
 */
export function OverviewView({
  initialOverview,
  initialStatus,
}: {
  /** What the Server Component already read, so the first paint is the page. */
  initialOverview?: DevelopmentOverview
  initialStatus?: Overview
}) {
  const { t } = useTranslation('overview')
  const overview = useDevelopmentOverview(initialOverview)
  const status = useStatus(initialStatus)

  if (overview.isPending && status.isPending) return <Loading label={t('reading')} />

  if (overview.error) {
    const code = overview.error instanceof ApiError ? overview.error.status : null
    if (code === 503 || code === 404) return <ReducedOverview reason={code} initialStatus={initialStatus} />
    return <ErrorBox error={overview.error} />
  }
  if (!overview.data) return <Loading label={t('reading')} />

  return <Dashboard data={overview.data} />
}

/**
 * The top of the page, shared by the full and the reduced dashboard: who
 * this machine is, with the gateway's and the host's verdict beside it, and
 * the readings in a strip.
 */
function OverviewHeader({ gatewayUp, pressure }: { gatewayUp: boolean; pressure?: HostPressure }) {
  const { t } = useTranslation('overview')
  const metrics = useMetricsCurrent()
  const history = useMetricsHistory('30m')
  const gateway = { up: gatewayUp, label: gatewayUp ? t('gatewayRunning') : t('gatewayDown') }

  return (
    <>
      <HostHeader
        title={t('title')}
        data={metrics.data}
        pending={metrics.isPending}
        pressure={pressure}
        gateway={gateway}
        className="mb-3"
      />
      {metrics.data?.host ? (
        <HostReadings data={metrics.data} history={history.data} className="mb-4" />
      ) : metrics.isPending ? (
        <HostSummarySkeleton />
      ) : null}
    </>
  )
}

function Dashboard({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const mayCreate = useCan('project:create')
  const closed = useClosedHosts()
  const { runtime } = data
  const needsYou = data.attention.length + (closed.length > 0 ? 1 : 0)

  return (
    <>
      <PageHeader
        title={t('title')}
        description={[
          t('summary.running', { count: runtime.environmentsRunning }),
          needsYou > 0 ? t('summary.needsYou', { count: needsYou }) : t('summary.allGood'),
        ].join(' ')}
        actions={
          mayCreate ? (
            <Button asChild variant="primary">
              <Link href="/projects?new=1">
                <Plus />
                {t('addProject')}
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="space-y-6">
        {/* On a phone the sentence under the title says this, and what needs a person comes first. */}
        <section aria-label={t('metric.label')} className="hidden gap-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t('metric.environments')}
            icon={<Layers />}
            value={runtime.environmentsRunning}
            unit={t('metric.ofRunning', { total: runtime.environmentsTotal })}
          />
          <MetricCard
            label={t('metric.services')}
            icon={<Activity />}
            value={runtime.servicesRunning - runtime.servicesUnhealthy}
            unit={t('metric.ofHealthy', { total: runtime.servicesRunning })}
          />
          <MetricCard
            label={t('metric.sites')}
            icon={<ShieldCheck />}
            value={runtime.routedUrls}
            unit={closed.length > 0 ? t('metric.undecided', { count: closed.length }) : t('metric.live')}
          />
          <HostUseCard data={data} />
        </section>

        <NeedsYou data={data} closed={closed} />

        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-0 flex-[999_1_32rem]">
            <QuickOpen />
          </div>
          <div className="min-w-0 flex-[1_1_20rem]">
            <OpenNow />
          </div>
        </div>
      </div>
    </>
  )
}

/** CPU, memory and disk as three bars, leading to Host where the rest of the readings are. */
function HostUseCard({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const host = data.resources.host
  const readings = [
    { label: t('metric.cpu'), ratio: host?.cpuUtilisation ?? null },
    { label: t('metric.memory'), ratio: host?.memoryUsedPercent ?? null },
    { label: t('metric.disk'), ratio: host?.storageUsedPercent ?? null },
  ]
  return (
    <Link
      href="/host"
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-5 py-4 shadow-raised transition-colors duration-100 hover:border-line-strong focus-ring"
    >
      <span className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">{t('metric.hostUse')}</span>
      {readings.map((reading) => (
        <span key={reading.label} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2 text-xs text-subtle">
          <span>{reading.label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-link"
              style={{ width: `${Math.round((reading.ratio ?? 0) * 100)}%` }}
            />
          </span>
          <span className="text-right font-semibold text-ink tabular-nums">
            {reading.ratio === null ? '—' : `${Math.round(reading.ratio * 100)}%`}
          </span>
        </span>
      ))}
    </Link>
  )
}

/**
 * What an attention item says, in the operator's language. The server writes
 * a summary in English for the API; the ones the page can rebuild from the
 * item's own fields are said again here, translated.
 */
function useAttentionText(data: DevelopmentOverview) {
  const { t } = useTranslation('overview')
  const { t: tp } = useTranslation('overview', { keyPrefix: 'pressure' })
  return (item: AttentionItem): string => {
    if (item.kind === 'host-pressure') {
      const reasons = pressureReasons(data.resources.host?.pressure, tp as never)
      if (reasons.length > 0) return t('attention.hostPressure', { reasons: reasons.join(', ') })
    }
    if (item.kind === 'service-unhealthy' && item.environment && item.service) {
      return t('attention.serviceUnhealthy', { environment: item.environment, service: item.service })
    }
    return item.summary
  }
}

/** Restarting from the alert, so nobody has to walk to the service to do it. */
function RestartService({ environment, service }: { environment: string; service: string }) {
  const { t } = useTranslation('overview')
  const queryClient = useQueryClient()
  const restart = useMutation({
    mutationFn: () => api.serviceAction(environment, service, 'restart'),
    onSettled: () => void queryClient.invalidateQueries(),
  })
  return (
    <Button size="sm" busy={restart.isPending} onClick={() => restart.mutate()}>
      {t('attention.restart')}
    </Button>
  )
}

/** One thing that needs a person: what it is, and the action beside it. */
function NeedsYouRow({
  tone,
  title,
  detail,
  children,
}: {
  tone: 'danger' | 'warn'
  title: string
  detail?: string | null
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-5 py-3 first:border-t-0">
      <StatusDot tone={tone} label={title} />
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="text-base font-semibold text-ink">{title}</div>
        {detail ? <div className="truncate text-xs text-subtle">{detail}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </li>
  )
}

function NeedsYou({ data, closed }: { data: DevelopmentOverview; closed: string[] }) {
  const { t } = useTranslation('overview')
  const text = useAttentionText(data)
  const mayOperate = useCan('environment:operate')
  const items = data.attention
  const count = items.length + (closed.length > 0 ? 1 : 0)

  if (count === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm text-muted shadow-raised">
        <h2 className="sr-only">{t('attention.title')}</h2>
        <ShieldCheck className="size-4 text-ok" aria-hidden />
        <span>{t('attention.none')}</span>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader
        title={t('attention.title')}
        icon={<AlertTriangle className="text-warn" />}
        meta={<Badge tone="warn">{count}</Badge>}
      />
      <ul>
        {items.map((item, index) => {
          const unhealthy = item.kind === 'service-unhealthy' && item.environment && item.service
          return (
            <NeedsYouRow
              key={`${item.kind}-${index}`}
              tone={item.severity === 'fail' ? 'danger' : 'warn'}
              title={text(item)}
              detail={unhealthy ? t('attention.unhealthyDetail') : item.project}
            >
              {unhealthy ? (
                <>
                  <Button asChild size="sm">
                    <Link
                      href={`/environments/${encodeURIComponent(item.environment ?? '')}?logs=${encodeURIComponent(item.service ?? '')}`}
                    >
                      {t('attention.logs')}
                    </Link>
                  </Button>
                  {mayOperate ? (
                    <RestartService environment={item.environment ?? ''} service={item.service ?? ''} />
                  ) : null}
                </>
              ) : (
                <Button asChild size="sm">
                  <Link href={item.href}>{t('attention.details')}</Link>
                </Button>
              )}
            </NeedsYouRow>
          )
        })}
        {closed.length > 0 ? (
          <NeedsYouRow
            tone="warn"
            title={t('attention.closedSites', { count: closed.length })}
            detail={closed.join(', ')}
          >
            <Button asChild size="sm">
              <Link href="/access">{t('attention.decide')}</Link>
            </Button>
          </NeedsYouRow>
        ) : null}
      </ul>
    </Card>
  )
}

/** Where a day usually starts: every running environment, its address and who may open it. */
function QuickOpen() {
  const { t } = useTranslation('overview')
  const environments = useEnvironments(true)
  const { owners } = useEnvironmentOwners()
  const exposure = useExposure()
  const mayOpen = (environments.data ?? [])
    .filter((environment) => environment.presence === 'live' && !environment.overrides?.archived)
    .sort(
      (a, b) =>
        Number(Boolean(b.overrides?.pinned)) - Number(Boolean(a.overrides?.pinned)) ||
        b.unhealthyCount - a.unhealthyCount ||
        a.name.localeCompare(b.name),
    )
  return (
    <Card>
      <CardHeader
        title={t('quick.title')}
        actions={
          <Link className="rounded-xs text-sm text-link hover:underline focus-ring" href="/projects">
            {t('projects.all')}
          </Link>
        }
      />
      {mayOpen.length === 0 ? (
        <Empty compact title={t('quick.empty')} hint={t('projects.emptyHint')} />
      ) : (
        <ul>
          {mayOpen.map((environment) => {
            const route = primaryRoute(environment)
            const owner = owners.get(environment.name)
            const mode = route
              ? exposure.data?.entries.find((item) => canonicalHost(item.host) === canonicalHost(route.host))?.mode
              : undefined
            return (
              <li
                key={environment.name}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 transition-colors duration-100 first:border-t-0 hover:bg-fill"
              >
                <Link
                  href={`/environments/${encodeURIComponent(environment.name)}`}
                  className="min-w-0 flex-[1_1_11rem] rounded-xs focus-ring"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot
                      tone={environment.unhealthyCount > 0 ? 'danger' : 'ok'}
                      label={environment.unhealthyCount > 0 ? t('quick.problem') : t('quick.healthy')}
                    />
                    <span className="truncate font-semibold text-ink">
                      {environment.overrides?.displayName ?? environment.name}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-subtle">
                    {[
                      owner?.name ?? t('quick.noProject'),
                      `${environment.runningCount}/${environment.serviceCount}`,
                    ].join(' · ')}
                  </span>
                </Link>
                <div className="flex min-w-0 flex-[2_1_15rem] items-center gap-1">
                  {route ? (
                    <RouteLine route={route} />
                  ) : (
                    <span className="truncate text-sm text-subtle">{t('quick.noAddress')}</span>
                  )}
                </div>
                {route && exposure.data?.enforced ? <HostAccess mode={mode ?? null} /> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Bridges and temporary links: an exposure nobody remembers is the one worth surfacing. */
function OpenNow() {
  const { t } = useTranslation('overview')
  const { uptime } = useFormat()
  const queryClient = useQueryClient()
  const mayRead = useCan('access:read')
  const mayOpen = useCan('access:open')
  const mayManage = useCan('access:manage')
  const access = useAccess(mayRead)
  const shares = useShares(mayRead)
  const refresh = () => void queryClient.invalidateQueries()
  const closeBridge = useMutation({ mutationFn: (id: string) => api.closeBridge(id), onSettled: refresh })
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeShare(id), onSettled: refresh })
  if (!mayRead) return null

  const bridges = access.data?.bridges ?? []
  const links = (shares.data?.shares ?? []).filter((share) => share.state === 'active')

  return (
    <Card>
      <CardHeader
        title={t('open.title')}
        actions={
          <Link className="rounded-xs text-sm text-link hover:underline focus-ring" href="/access">
            {t('open.all')}
          </Link>
        }
      />
      {bridges.length === 0 && links.length === 0 ? (
        <CardBody className="text-sm text-subtle">{t('open.none')}</CardBody>
      ) : (
        <ul>
          {bridges.map((bridge) => (
            <li key={bridge.id} className="flex items-start gap-3 border-t border-line px-5 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">{t('open.bridge')}</div>
                <div className="truncate text-xs text-subtle">
                  {bridge.project} / {bridge.service}
                </div>
                <Mono kind="port" className="mt-1 block truncate text-xs">
                  {bridge.bindIp}:{bridge.localPort}
                </Mono>
                <div className="text-xs text-subtle">{bridge.expiresAt ? t('open.expiresAt') : t('open.noExpiry')}</div>
              </div>
              {mayOpen ? (
                <Button size="sm" busy={closeBridge.isPending} onClick={() => closeBridge.mutate(bridge.id)}>
                  {t('open.close')}
                </Button>
              ) : null}
            </li>
          ))}
          {links.map((share) => (
            <li key={share.id} className="flex items-start gap-3 border-t border-line px-5 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">
                  {share.mode === 'protected' ? t('open.protectedLink') : t('open.publicLink')}
                </div>
                <div className="truncate text-xs text-subtle">
                  {share.project} / {share.service}
                </div>
                <Mono kind="url" value={share.url} className="mt-1 block truncate text-xs">
                  {share.host}
                </Mono>
                <div className="text-xs text-subtle">
                  {t('open.expiresIn', { time: uptime(share.expiresInSeconds) })}
                </div>
              </div>
              {mayManage ? (
                <Button size="sm" busy={revoke.isPending} onClick={() => revoke.mutate(share.id)}>
                  {t('open.revoke')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** The panel with no database, or a server that predates the dashboard: the gateway's own status, and nothing invented. */
function ReducedOverview({ reason, initialStatus }: { reason: number; initialStatus?: Overview }) {
  const { t } = useTranslation('overview')
  const status = useStatus(initialStatus)
  if (status.isPending) return <Loading label={t('reading')} />
  if (status.error) return <ErrorBox error={status.error} />
  if (!status.data) return null
  const { gateway, problems } = status.data
  return (
    <>
      <OverviewHeader gatewayUp={gateway.up} />
      <div className="space-y-4">
        <Empty
          compact
          icon={CircleDot}
          title={reason === 503 ? t('reduced.needsDatabase') : t('reduced.unavailable')}
          hint={t('reduced.hint')}
        />
        <Card>
          <CardHeader title={t('attention.title')} />
          {problems.length === 0 ? (
            <CardBody>
              <div className="flex items-center gap-2 text-sm text-ok">
                <CheckCircle2 className="size-4" aria-hidden />
                {t('attention.none')}
              </div>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {problems.map((problem) => (
                <li key={problem.id} className="flex gap-2.5 px-5 py-2.5">
                  {problem.status === 'fail' ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <DiagnosticText diagnostic={problem} part="title" className="text-sm font-medium text-ink" />
                    <DiagnosticText diagnostic={problem} part="detail" className="text-xs text-muted" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
