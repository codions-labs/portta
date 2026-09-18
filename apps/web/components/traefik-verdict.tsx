'use client'

import { ExternalLink } from 'lucide-react'
import type { ContainerSummary } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { useServiceTraefik } from '../lib/queries/index.ts'
import { Mono } from './copy.tsx'
import { Badge, StatusIndicator } from './ui/badge.tsx'

export function TraefikVerdictRow({ container, enabled }: { container: ContainerSummary; enabled: boolean }) {
  const { t } = useTranslation('common', { keyPrefix: 'traefikVerdict' })
  const query = useServiceTraefik(container.id, enabled)

  if (query.isPending) {
    return <span className="text-xs text-subtle">{t('asking')}</span>
  }
  if (query.error || !query.data) {
    return <span className="text-xs text-subtle">{t('couldNotAsk')}</span>
  }

  const data = query.data

  if (!data.available) {
    return (
      <div className="space-y-1 text-xs text-subtle">
        <div>{data.reason}</div>
        <div>{t('labelsFallback')}</div>
      </div>
    )
  }

  if (data.routers.length === 0) {
    return (
      <div className="space-y-1 text-xs">
        <StatusIndicator tone="danger" emphasis="tone">
          {t('noRouter')}
        </StatusIndicator>
        <div className="text-subtle">{t('noRouterDetail', { hosts: data.expectedHosts.join(', ') })}</div>
      </div>
    )
  }

  return (
    <div className="space-y-2 text-xs">
      {data.routers.map((router) => (
        <div key={router.name} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Mono kind="text" tone="ink">
              {router.name}
            </Mono>
            <StatusIndicator tone={router.status === 'enabled' ? 'ok' : 'danger'}>{router.status}</StatusIndicator>
            {router.entryPoints.map((entry) => (
              <Badge key={entry} tone="outline">
                {entry}
              </Badge>
            ))}
            {router.dashboardUrl ? (
              <a
                className="inline-flex items-center gap-1 rounded-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-ring"
                href={router.dashboardUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('dashboard')}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>

          <div className="break-all">
            <Mono kind="text" tone="subtle" className="text-2xs whitespace-normal">
              {router.rule}
            </Mono>
          </div>

          {router.middlewares.length > 0 ? (
            <div className="text-subtle">
              {t('middlewares')} {router.middlewares.join(', ')}
            </div>
          ) : null}

          {router.servers.length > 0 ? (
            <div>
              <Mono kind="text" tone="subtle" className="text-2xs">
                → {router.servers.join(', ')}
              </Mono>
            </div>
          ) : null}

          {router.errors.length > 0 ? <div className="text-danger">{router.errors.join('; ')}</div> : null}
        </div>
      ))}
    </div>
  )
}
