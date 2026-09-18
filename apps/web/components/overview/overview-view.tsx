'use client'

import { AlertTriangle, Boxes, CheckCircle2, CircleDot, GitCommitHorizontal, ShieldCheck, XCircle } from 'lucide-react'
import type { AttentionItem, DevelopmentOverview, HostPressure, Overview } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { CodeChip, Mono } from '@/components/copy'
import { DiagnosticText } from '@/components/diagnostic-text'
import { CommitRow } from '@/components/entities/commit-row'
import { ProjectRow } from '@/components/entities/project-card'
import { ResourceUsage } from '@/components/entities/resource-usage'
import { SessionRow } from '@/components/entities/session-row'
import { EnvironmentActions } from '@/components/environment-actions'
import { HostHeader, HostReadings, HostSummarySkeleton, pressureReasons } from '@/components/host-summary'
import { AssignedWorkPanel } from '@/components/issues/assigned-work-panel'
import { Empty, ErrorBox, Loading, NoValue, SectionHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardSection } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { fromPulse } from '@/lib/projects'
import { useDevelopmentOverview, useEnvironments, useMetricsCurrent, useMetricsHistory, useStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * What is happening: the host it happens on, the work, who is on it, what
 * needs attention, what changed. Infrastructure has its own pages; this one
 * answers the question a person asks when they open the panel.
 *
 * The page has no visible title: its subject is the host, so the host's
 * name and kind sit where a title would, the gateway's and the host's
 * verdict beside them, the readings in one strip under them. The page is
 * dense because related things share a line, not because anything is
 * small; a panel with nothing to say takes one row rather than a card.
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
  return (
    <>
      <OverviewHeader gatewayUp={data.gateway.up} pressure={data.resources.host?.pressure} />

      <div className="space-y-4">
        <AttentionBand data={data} />

        {/* The work and who is on it, side by side. With nobody working the
            work takes the whole row rather than leaving half of it empty. */}
        <div className={cn('grid items-start gap-4', data.sessions.length > 0 && 'xl:grid-cols-2')}>
          <AssignedWorkPanel work={data.work} />
          {data.sessions.length > 0 ? <SessionsPanel data={data} /> : null}
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-5">
          <div className="min-w-0 xl:col-span-3">
            <ProjectsPanel data={data} />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <EnvironmentUsagePanel data={data} />
          </div>
        </div>

        <CodePanel data={data} />
      </div>
    </>
  )
}

function SessionsPanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const { t: ts } = useTranslation('sessions')
  return (
    <Card>
      <CardHeader
        title={t('sessions.title')}
        meta={
          <Badge tone="agent" dot>
            {ts('active', { count: data.sessions.length })}
          </Badge>
        }
      />
      {data.sessions.map((session) => (
        <SessionRow key={session.id} session={session} showProject />
      ))}
    </Card>
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

/**
 * What needs attention, sized to how much there is: one line saying nothing
 * does, one band for one thing, a list for several. A card reserved for an
 * alert that is usually absent is space the work could have had.
 */
function AttentionBand({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const text = useAttentionText(data)
  const items = data.attention
  const failures = items.filter((item) => item.severity === 'fail').length
  // The diagnostics page (`/gateway`) is ported with the infrastructure pages;
  // until it exists this band names what needs attention and links each item,
  // rather than offering a button that leads nowhere.
  const diagnostics = null

  if (items.length === 0) {
    return (
      <div className="flex h-8 items-center gap-2 px-1 text-xs text-subtle">
        <h2 className="sr-only">{t('attention.title')}</h2>
        <ShieldCheck className="size-3.5 text-ok" aria-hidden />
        <span>{t('attention.none')}</span>
        <span className="ml-auto">{diagnostics}</span>
      </div>
    )
  }

  const rows = items.map((item, index) => (
    <li
      key={`${item.kind}-${index}`}
      className="flex h-8 min-w-0 items-center gap-2.5 px-3 text-sm transition-colors duration-100 hover:bg-fill"
    >
      {item.severity === 'fail' ? (
        <XCircle className="size-3.5 shrink-0 text-danger" aria-hidden />
      ) : (
        <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden />
      )}
      <a
        className="min-w-0 flex-1 truncate rounded-xs text-ink underline-offset-2 hover:underline focus-ring"
        href={item.href}
        title={text(item)}
      >
        {text(item)}
      </a>
      {item.project ? <span className="hidden shrink-0 text-xs text-subtle sm:inline">{item.project}</span> : null}
    </li>
  ))

  return (
    <section
      aria-label={t('attention.title')}
      className={cn('overflow-hidden rounded-lg border', failures > 0 ? 'border-danger/35' : 'border-warn/35')}
    >
      <div className={cn('flex h-8 items-center gap-2 px-3 text-xs', failures > 0 ? 'bg-danger/6' : 'bg-warn/8')}>
        <h2 className={cn('font-medium', failures > 0 ? 'text-danger' : 'text-warn')}>{t('attention.title')}</h2>
        <span className="text-subtle">{t('attention.count', { count: items.length })}</span>
        <span className="ml-auto">{diagnostics}</span>
      </div>
      <ul className="divide-y divide-line-subtle bg-surface">{rows}</ul>
    </section>
  )
}

function ProjectsPanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const shown = data.projects.filter((pulse) => !pulse.archived).slice(0, 8)
  return (
    <Card>
      <CardHeader
        title={t('projects.title')}
        icon={<Boxes />}
        meta={<span className="text-xs font-normal text-subtle tabular-nums">{shown.length}</span>}
        actions={
          <a className="rounded-xs px-1 text-xs text-subtle hover:text-ink hover:underline focus-ring" href="/projects">
            {t('projects.all')}
          </a>
        }
      />
      {shown.length === 0 ? (
        <Empty compact title={t('projects.empty')} hint={t('projects.emptyHint')} />
      ) : (
        shown.map((pulse) => <ProjectRow key={pulse.slug} item={fromPulse(pulse)} />)
      )}
    </Card>
  )
}

function EnvironmentUsagePanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const environments = useEnvironments(true)
  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  return (
    <Card>
      <CardHeader
        title={t('resources.top')}
        meta={
          <span className="text-xs font-normal text-subtle tabular-nums">
            {t('resources.environments')} {data.runtime.environmentsRunning}/{data.runtime.environmentsTotal}
          </span>
        }
      />
      {data.resources.topProjects.length === 0 ? (
        <Empty compact title={t('resources.none')} hint={t('resources.topDescription')} />
      ) : (
        data.resources.topProjects.map((entry) => {
          const environment = known.get(entry.environment)
          return (
            <div
              key={entry.environment}
              className="group flex h-9 min-w-0 items-center gap-2 border-b border-line-subtle px-3 text-sm last:border-b-0 hover:bg-fill"
            >
              <a
                className="min-w-0 flex-1 truncate rounded-xs font-medium underline-offset-2 hover:underline focus-ring"
                href={
                  entry.slug
                    ? `/projects/${encodeURIComponent(entry.slug)}`
                    : `/environments/${encodeURIComponent(entry.environment)}`
                }
              >
                {entry.name}
              </a>
              <ResourceUsage
                cpu={entry.cpuUtilisation}
                memoryBytes={entry.memoryUsedBytes}
                className="ml-auto shrink-0 text-2xs"
              />
              {environment && environment.runningCount > 0 ? (
                <span className="row-actions">
                  <EnvironmentActions project={environment} />
                </span>
              ) : null}
            </div>
          )
        })
      )}
    </Card>
  )
}

/**
 * Recent commits and local changes. With nothing collected yet it is a
 * heading and one line, not a card with an empty state in the middle.
 */
function CodePanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const dirty = data.code.dirtyRepositories
  const commits = data.code.recentCommits

  if (dirty.length === 0 && commits.length === 0) {
    return (
      <section aria-label={t('code.title')}>
        <SectionHeader title={t('code.title')} description={t('code.description')} />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-subtle">
          <GitCommitHorizontal className="size-3.5" aria-hidden />
          <span className="text-muted">{t('code.empty')}</span>
          <span>{t('code.emptyHintShort')}</span>
          <CodeChip tone="muted">portta repos scan</CodeChip>
        </div>
      </section>
    )
  }

  return (
    <Card>
      <CardHeader title={t('code.title')} icon={<GitCommitHorizontal />} description={t('code.description')} />
      {dirty.length > 0 ? (
        <CardSection label={t('code.dirty')} count={dirty.length}>
          <ul className="divide-y divide-line-subtle">
            {dirty.map((repository) => (
              <li key={repository.id} className="flex h-8 flex-wrap items-center gap-2 px-3 text-sm">
                <a
                  className="rounded-xs font-medium underline-offset-2 hover:underline focus-ring"
                  href={`/projects/${encodeURIComponent(repository.project)}/repositories/${encodeURIComponent(repository.id)}`}
                >
                  {repository.name}
                </a>
                <span className="text-2xs text-subtle">{repository.project}</span>
                {repository.branch ? (
                  <Mono kind="branch" className="text-2xs">
                    {repository.branch}
                  </Mono>
                ) : (
                  <NoValue />
                )}
                {repository.changed > 0 ? (
                  <Badge tone="warn">{t('code.uncommitted', { count: repository.changed })}</Badge>
                ) : null}
                {repository.ahead > 0 ? <Badge tone="outline">↑{repository.ahead}</Badge> : null}
                {repository.behind > 0 ? <Badge tone="outline">↓{repository.behind}</Badge> : null}
              </li>
            ))}
          </ul>
        </CardSection>
      ) : null}
      {commits.length > 0 ? (
        <CardSection label={t('code.recent')} count={commits.length}>
          <ul className="divide-y divide-line-subtle">
            {commits.map((commit) => (
              <li key={`${commit.repository.id}-${commit.sha}`} className="flex items-center gap-2 px-3 py-0.5 text-sm">
                <a
                  className="w-32 shrink-0 truncate rounded-xs text-xs text-subtle hover:text-ink focus-ring"
                  href={`/projects/${encodeURIComponent(commit.project)}/repositories/${encodeURIComponent(commit.repository.id)}/commits`}
                  title={`${commit.project} · ${commit.repository.name}`}
                >
                  {commit.repository.name}
                </a>
                <CommitRow
                  commit={{
                    sha: commit.sha,
                    shortSha: commit.shortSha,
                    subject: commit.subject,
                    author: commit.author,
                    date: commit.date,
                    url: commit.url,
                  }}
                  className="min-w-0 flex-1"
                />
              </li>
            ))}
          </ul>
        </CardSection>
      ) : null}
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
                <li key={problem.id} className="flex gap-2.5 px-3 py-1.5">
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
