'use client'

import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import type { Diagnostic } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { LearnMore } from '@/components/settings/learn-more'
import { Empty, ErrorBox, Loading, PageHeader, SectionHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useEnvironmentReport, useHostSecurityReport } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { SshKeysPanel } from './ssh-keys-panel'

const CATEGORIES = ['infrastructure', 'development', 'agents'] as const

function tone(status: Diagnostic['status']) {
  if (status === 'pass') return 'ok' as const
  if (status === 'warn') return 'warn' as const
  if (status === 'fail') return 'danger' as const
  return 'info' as const
}

function StatusIcon({ status }: { status: Diagnostic['status'] }) {
  if (status === 'pass') return <CheckCircle2 className="size-4 text-ok" />
  if (status === 'warn') return <AlertTriangle className="size-4 text-warn" />
  if (status === 'fail') return <XCircle className="size-4 text-danger" />
  return <CircleHelp className="size-4 text-info" />
}

export function EnvironmentView() {
  const { t } = useTranslation('settings')
  const { relativeTime } = useFormat()
  const query = useEnvironmentReport()
  const security = useHostSecurityReport()
  if (query.isPending || security.isPending) return <Loading />
  if (query.error || security.error) return <ErrorBox error={query.error ?? security.error} />
  const report = query.data

  return (
    <>
      <PageHeader title={t('environment.title')} description={t('environment.description')} />
      {!report || report.collectedAt === null ? (
        <Empty title={t('environment.neverCollected')} hint={t('environment.runCommand')} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={report.summary.problems > 0 ? 'danger' : 'ok'}>
              {t('environment.summary', report.summary)}
            </Badge>
            <span>{t('environment.collected', { when: relativeTime(report.collectedAt) })}</span>
            {report.stale ? <Badge tone="warn">{t('environment.stale')}</Badge> : null}
            <span className="ml-auto text-xs text-subtle">
              {t('environment.refreshHint')} <Mono kind="command">portta env report</Mono>
            </span>
          </div>
          {CATEGORIES.map((category) => {
            const checks = report.checks.filter((check) => check.category === category)
            if (checks.length === 0) return null
            return (
              <section key={category} className="space-y-2">
                <SectionHeader title={t(`environment.categories.${category}`)} />
                <Card>
                  <ul className="divide-y divide-line-subtle">
                    {checks.map((check) => (
                      <li key={check.id} className="flex min-h-9 gap-2 px-3 py-2">
                        <span className="mt-0.5 shrink-0">
                          <StatusIcon status={check.status} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-ink">{check.title}</span>
                            <Badge tone={tone(check.status)}>{t(`environment.status.${check.status}`)}</Badge>
                            {check.tool?.version ? (
                              <Mono kind="text" tone="muted" className="text-2xs">
                                {check.tool.version}
                              </Mono>
                            ) : null}
                            {check.tool?.path ? (
                              <Mono kind="path" tone="subtle" className="ml-auto text-2xs">
                                {check.tool.path}
                              </Mono>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted">{check.detail}</p>
                          {check.details && check.details.length > 0 ? (
                            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-subtle">
                              {check.details.map((finding, index) => (
                                <li key={`${check.id}-${index}`} className="inline-flex items-center gap-1">
                                  <StatusIcon status={finding.status} /> {finding.text}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {check.status !== 'pass' && check.fix ? (
                            <p className="mt-1 text-2xs text-subtle">
                              {t('environment.fix')}: {check.fix}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )
          })}
          {security.data?.collectedAt ? (
            <section className="space-y-2">
              <SectionHeader
                title={t('environment.hostSecurity')}
                description={t('environment.hostSecurityDescription', {
                  when: relativeTime(security.data.collectedAt),
                })}
              />
              <Card>
                <ul className="divide-y divide-line-subtle">
                  {security.data.checks.map((check) => (
                    <li key={check.id} className="flex min-h-9 gap-2 px-3 py-2">
                      <span className="mt-0.5 shrink-0">
                        <StatusIcon status={check.status} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">{check.title}</span>
                          <Badge tone={tone(check.status)}>{t(`environment.status.${check.status}`)}</Badge>
                        </div>
                        <p className="text-xs text-muted">{check.detail}</p>
                        {check.rationale ? <p className="mt-1 text-2xs text-subtle">{check.rationale}</p> : null}
                        {check.docs ? <LearnMore citation={check.docs} /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : (
            <p className="text-xs text-subtle">{t('environment.hostSecurityMissing')}</p>
          )}
        </div>
      )}
      <div className="mt-6">
        <SshKeysPanel />
      </div>
    </>
  )
}
