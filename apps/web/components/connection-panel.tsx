'use client'

import { Eye, EyeOff } from 'lucide-react'
import type { ServiceConnection, ServiceEndpoint } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServiceConnection } from '../lib/queries/index.ts'
import { CopyButton, Mono } from './copy.tsx'
import { ScopeBadge } from './status.tsx'
import { Button } from './ui/button.tsx'

function MaskedSecret({
  value,
  revealLabel,
  hideLabel,
  copyLabel,
}: {
  value: string
  revealLabel: string
  hideLabel: string
  copyLabel: string
}) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <Mono kind="text" tone="ink" className="truncate text-xs">
        {revealed ? value : '••••••••'}
      </Mono>
      <Button
        variant="ghost"
        size="icon-sm"
        title={revealed ? hideLabel : revealLabel}
        aria-label={revealed ? hideLabel : revealLabel}
        onClick={() => setRevealed((open) => !open)}
      >
        {revealed ? <EyeOff /> : <Eye />}
      </Button>
      <CopyButton value={value} label={copyLabel} />
    </span>
  )
}

function EndpointRow({ endpoint }: { endpoint: ServiceEndpoint }) {
  const { t } = useTranslation('access')
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <ScopeBadge scope={endpoint.scope} />
      {endpoint.usable ? (
        <Mono kind="url" tone="ink" className="text-xs">
          {endpoint.url}
        </Mono>
      ) : (
        <span className="text-xs text-subtle">{endpoint.problem ?? endpoint.url}</span>
      )}
      {endpoint.usable ? (
        <>
          <CopyButton value={endpoint.url} label={t('connection.copyAddress')} />
          <CopyButton value={endpoint.connectionString} label={t('connection.copyConnectionString')} />
        </>
      ) : null}
    </div>
  )
}

export function ConnectionDetails({ data }: { data: ServiceConnection }) {
  const { t } = useTranslation('access')
  const { credentials, endpoints } = data
  return (
    <div className="space-y-2">
      {endpoints
        .filter((entry) => entry.provider !== 'internal')
        .map((endpoint) => (
          <EndpointRow key={`${endpoint.provider}:${endpoint.url}`} endpoint={endpoint} />
        ))}
      {endpoints.every((entry) => entry.provider === 'internal') ? <EndpointRow endpoint={endpoints[0]!} /> : null}
      {credentials.discovered && credentials.password ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{t('connection.password')}</span>
          <MaskedSecret
            value={credentials.password}
            revealLabel={t('connection.revealPassword')}
            hideLabel={t('connection.hidePassword')}
            copyLabel={t('connection.copyPassword')}
          />
        </div>
      ) : (
        <div className="text-2xs text-subtle">{credentials.reason ?? t('connection.templateHint')}</div>
      )}
    </div>
  )
}

export function ConnectionPanel({ project, service }: { project: string; service: string }) {
  const { t } = useTranslation('access')
  const [open, setOpen] = useState(false)
  const query = useServiceConnection(project, service, open)

  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
        {open ? t('connection.hide') : t('connection.show')}
      </Button>
      {open && query.isPending ? <div className="mt-1 text-xs text-subtle">{t('connection.loading')}</div> : null}
      {open && query.error ? <div className="mt-1 text-xs text-danger">{query.error.message}</div> : null}
      {open && query.data ? (
        <div className="mt-1.5">
          <ConnectionDetails data={query.data} />
        </div>
      ) : null}
    </div>
  )
}
