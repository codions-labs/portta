'use client'

// The top of every Host page: which machine this is, how it is doing, what can
// be done to it, and its sections.

import { usePathname } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { pressureReasons } from '@/components/host-summary'
import { Callout, PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { LinkTabs } from '@/components/ui/tabs'
import { usePrincipal } from '@/lib/principal'
import {
  useContainers,
  useDevelopmentOverview,
  useEnvironmentReport,
  useGateway,
  useMetricsCurrent,
  useNetwork,
} from '@/lib/queries'
import { pressureTone } from '@/lib/resources'
import { narrowTone } from '@/lib/tone'
import { useFormat } from '@/lib/use-format'
import { GATEWAY_COMPONENT_COUNT } from './gateway-parts'
import { type GatewayRestart, HostActions } from './host-actions'
import { visibleHostSections } from './sections'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span>
      {label} <b className="font-semibold text-ink">{children}</b>
    </span>
  )
}

export function HostSections() {
  const { t } = useTranslation('nav')
  const { t: th } = useTranslation('host')
  const { t: tg } = useTranslation('gateway')
  const { t: tp } = useTranslation('overview', { keyPrefix: 'pressure' })
  const { uptime } = useFormat()
  const pathname = usePathname()
  const sections = visibleHostSections(usePrincipal().permissions)
  const opens = (id: string) => sections.some((section) => section.id === id)
  const [restarted, setRestarted] = useState<GatewayRestart | null>(null)

  const metrics = useMetricsCurrent()
  const overview = useDevelopmentOverview()
  const gateway = useGateway(opens('gateway'))
  const containers = useContainers({}, opens('containers'))
  const network = useNetwork(opens('network'))
  const report = useEnvironmentReport(opens('health'))

  const host = metrics.data?.host ?? null
  const hostname = host?.hostname ?? metrics.data?.instance.hostname ?? t('host')
  const pressure = overview.data?.resources.host?.pressure
  const system = host
    ? [[host.distro ?? host.platform, host.version].filter(Boolean).join(' '), host.architecture]
        .filter(Boolean)
        .join(' · ')
    : ''
  const profile = gateway.data?.profile
  const reasons = pressureReasons(pressure, tp as never)

  const counts: Record<string, number | undefined> = {
    // Only what needs somebody counts here: a green list is not a number to read.
    health: report.data?.summary.problems || undefined,
    containers: containers.data?.total,
    network: network.data?.networks.length,
    gateway: GATEWAY_COMPONENT_COUNT,
  }
  // `/host` is a prefix of every other section, so the longest match is the page.
  const active = [...sections]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`))

  return (
    <>
      <PageHeader
        title={hostname}
        badge={
          pressure?.measured ? (
            <Badge
              tone={narrowTone(pressureTone(pressure.level))}
              title={reasons.length > 0 ? tp('because', { reasons: reasons.join(', ') }) : tp('normalHint')}
            >
              {tp(pressure.level)}
            </Badge>
          ) : null
        }
        meta={
          <>
            {system ? <span>{system}</span> : null}
            {host?.uptimeSeconds != null ? <Fact label={th('facts.up')}>{uptime(host.uptimeSeconds)}</Fact> : null}
            {gateway.data ? <Fact label={th('facts.portta')}>{gateway.data.panelVersion}</Fact> : null}
            {profile ? (
              <Fact label={th('facts.profile')}>{th(`facts.profiles.${profile}`, { defaultValue: profile })}</Fact>
            ) : null}
          </>
        }
        actions={<HostActions onRestarted={setRestarted} />}
      />
      {restarted ? (
        <Callout tone="info" className="mb-4">
          {tg('restarted', { components: restarted.restarted.join(', '), note: restarted.note })}{' '}
          <Mono kind="command" tone="ink">
            {restarted.applyCommand}
          </Mono>
        </Callout>
      ) : null}
      <LinkTabs
        label={t('host')}
        active={active?.id ?? ''}
        tabs={sections.map((section) => ({
          id: section.id,
          label: t(`hostSections.${section.id}`),
          href: section.href,
          count: counts[section.id],
        }))}
      />
    </>
  )
}
