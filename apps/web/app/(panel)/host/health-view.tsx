'use client'

// How the server is doing: what it reads now, who is using it, and what its
// last check found. Problems first; what is fine waits behind one click.

import type { Diagnostic } from 'portta-contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import {
  FreshnessNotice,
  ServerClock,
  ServerDetails,
  UsageCards,
  WholeServerNote,
  WhoUsesServer,
} from '@/components/host/server-panels'
import { LearnMore } from '@/components/settings/learn-more'
import { Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useEnvironmentReport, useHostSecurityReport, useMetricsCurrent } from '@/lib/queries'
import type { UsageKind } from '@/lib/server-usage'
import { useFormat } from '@/lib/use-format'

/** How many checks fit before the list is asked for. */
const FIRST_CHECKS = 5
const ORDER: Record<Diagnostic['status'], number> = { fail: 0, warn: 1, info: 2, pass: 3 }

function dotTone(status: Diagnostic['status']) {
  if (status === 'pass') return 'ok' as const
  if (status === 'warn') return 'warn' as const
  if (status === 'fail') return 'danger' as const
  return 'neutral' as const
}

function Checks() {
  const { t } = useTranslation('settings', { keyPrefix: 'environment' })
  const { t: th } = useTranslation('host', { keyPrefix: 'health.checks' })
  const { relativeTime } = useFormat()
  const [all, setAll] = useState(false)
  const report = useEnvironmentReport()
  const security = useHostSecurityReport()
  if (report.isPending || security.isPending) return <Loading />
  if (report.error || security.error) return <ErrorBox error={report.error ?? security.error} />

  const collectedAt = report.data?.collectedAt ?? null
  const checks = [...(report.data?.checks ?? []), ...(security.data?.collectedAt ? security.data.checks : [])].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status],
  )
  const shown = all ? checks : checks.slice(0, FIRST_CHECKS)

  return (
    <Card>
      <CardHeader
        title={th('title')}
        actions={
          collectedAt ? (
            <span className="text-xs text-subtle">
              {report.data?.stale ? t('stale') : t('collected', { when: relativeTime(collectedAt) })}
            </span>
          ) : null
        }
      />
      {collectedAt === null ? (
        <Empty title={t('neverCollected')} hint={t('runCommand')} />
      ) : (
        <>
          <ul>
            {shown.map((check) => {
              const open = all || check.status === 'fail' || check.status === 'warn'
              return (
                <li key={check.id} className="border-t border-line px-5 py-2.5 first:border-t-0">
                  <div className="flex items-center gap-2.5">
                    <StatusDot tone={dotTone(check.status)} label={t(`status.${check.status}`)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{check.title}</span>
                    <span className="shrink-0 text-xs text-subtle">
                      {'tool' in check && check.tool?.version ? check.tool.version : t(`status.${check.status}`)}
                    </span>
                  </div>
                  {open ? (
                    <div className="mt-1 space-y-0.5 pl-[1.125rem] text-xs text-muted">
                      <p>{check.detail}</p>
                      {'rationale' in check && check.rationale ? (
                        <p className="text-subtle">{check.rationale}</p>
                      ) : null}
                      {check.status !== 'pass' && check.fix ? (
                        <p className="text-subtle">
                          {t('fix')}: {check.fix}
                        </p>
                      ) : null}
                      {'docs' in check && check.docs ? <LearnMore citation={check.docs} /> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {checks.length > FIRST_CHECKS ? (
            <div className="border-t border-line px-3 py-1.5">
              <Button variant="ghost" size="sm" onClick={() => setAll((value) => !value)}>
                {all ? th('showFewer') : th('showAll', { count: checks.length })}
              </Button>
            </div>
          ) : null}
          <p className="border-t border-line px-5 py-2 text-xs text-subtle">
            {t('refreshHint')} <Mono kind="command">portta env report</Mono>
          </p>
        </>
      )}
    </Card>
  )
}

function Clock() {
  const metrics = useMetricsCurrent()
  // The clock reads the server's zone, so it needs a moving "now" and nothing else from the browser.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  if (!metrics.data?.host) return null
  return <ServerClock host={metrics.data.host} now={now} />
}

function Details() {
  const metrics = useMetricsCurrent()
  const [now] = useState(() => Date.now())
  if (!metrics.data?.host) return null
  return <ServerDetails data={metrics.data} now={now} />
}

export function HostHealthView() {
  const [kind, setKind] = useState<UsageKind>('memory')
  return (
    <div className="space-y-5">
      <FreshnessNotice />
      <WholeServerNote />
      <UsageCards />
      <WhoUsesServer kind={kind} onKind={setKind} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Checks />
        <Clock />
      </div>
      <Details />
    </div>
  )
}
