'use client'

import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useGateway } from '../lib/queries/index.ts'
import { CopyButton, Mono } from './copy.tsx'
import { primaryUsable } from './dashboard-card-lib.ts'
import { Callout } from './shell-bits.tsx'
import { ScopeBadge } from './status.tsx'
import { Badge, StatusIndicator } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'

export function DashboardCard() {
  const { t } = useTranslation('settings', { keyPrefix: 'dashboard' })
  const { t: tc } = useTranslation('common')
  const query = useGateway()
  const dashboard = query.data?.dashboard
  if (!dashboard) return null

  const primary = primaryUsable(dashboard.endpoints)
  const tailnetHole = query.data?.tailscale.enabled && dashboard.enabled && dashboard.expose === 'local'

  return (
    <Card>
      <CardHeader title={t('title')} description={t('description')} />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusIndicator tone={dashboard.enabled ? 'ok' : 'neutral'} emphasis="ink">
            {dashboard.enabled ? tc('enabled') : tc('disabled')}
          </StatusIndicator>
          {dashboard.enabled ? <Badge>{dashboard.expose}</Badge> : null}
          {dashboard.enabled ? <Badge>{t('loopbackOnly')}</Badge> : null}
        </div>

        {dashboard.endpoints
          .filter((entry) => entry.scope !== 'internal')
          .map((endpoint) => (
            <div key={`${endpoint.provider}:${endpoint.url}`} className="flex min-w-0 flex-wrap items-center gap-1.5">
              <ScopeBadge scope={endpoint.scope} />
              {endpoint.usable ? (
                <>
                  <Mono kind="url" tone="ink" className="text-xs">
                    {endpoint.url}
                  </Mono>
                  <CopyButton value={endpoint.url} label={t('copyAddress')} />
                </>
              ) : (
                <span className="text-xs text-subtle">{endpoint.problem ?? endpoint.url}</span>
              )}
            </div>
          ))}

        {dashboard.enabled && dashboard.expose === 'local' ? (
          <p className="text-xs text-subtle">{t('loopbackHint')}</p>
        ) : null}

        {tailnetHole ? <Callout tone="warn">{t('tailnetWarning')}</Callout> : null}

        <Button
          size="sm"
          variant="primary"
          disabled={!primary}
          title={primary ? t('open') : t('openDisabled')}
          onClick={() => {
            if (primary) window.open(primary.url, '_blank', 'noreferrer')
          }}
        >
          <ExternalLink />
          {t('open')}
        </Button>
      </CardBody>
    </Card>
  )
}
