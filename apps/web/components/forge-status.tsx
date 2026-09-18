'use client'

// Whether this host can read and write issues, and what is missing when it
// cannot.
//
// Read-only on purpose. Both credentials live on the host beside the daemon —
// `gh auth` for GitHub, `LINEAR_API_KEY` for Linear — and the panel is a
// container that can neither hold them nor set them (ADR 0018, ADR 0047). So
// this card diagnoses and names the command; it never offers a field.

import type { ProviderStatus } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { useForgeStatus } from '../lib/queries/index.ts'
import { Mono } from './copy.tsx'
import { ErrorBox, KeyValue, Loading } from './shell-bits.tsx'
import { StatusIndicator } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'

interface ProviderProps {
  name: string
  /** The one command that fixes "installed but nobody is signed in". */
  fix: string
  status: ProviderStatus
}

function Provider({ name, fix, status }: ProviderProps) {
  const { t } = useTranslation('gateway', { keyPrefix: 'settings.issues' })
  const tone = status.authenticated ? 'ok' : status.available ? 'warn' : 'neutral'
  const state = status.authenticated ? t('signedIn') : status.available ? t('notSignedIn') : t('notInstalled')
  return (
    <KeyValue label={name}>
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <StatusIndicator tone={tone}>{state}</StatusIndicator>
          {status.authenticated ? <span>{status.account ?? ''}</span> : null}
        </span>
        {!status.authenticated && status.reason ? <span className="text-subtle">{status.reason}</span> : null}
        {!status.authenticated && status.available ? <Mono>{fix}</Mono> : null}
      </span>
    </KeyValue>
  )
}

export function ForgeStatusCard() {
  const { t } = useTranslation('gateway', { keyPrefix: 'settings.issues' })
  const query = useForgeStatus()

  if (query.isPending) return <Loading label={t('reading')} />
  if (query.error) return <ErrorBox error={query.error} />

  const status = query.data!
  return (
    <Card>
      <CardHeader title={t('title')} description={t('description')} />
      <CardBody>
        <Provider name="GitHub" fix="gh auth login" status={status.github} />
        <Provider name="Linear" fix="LINEAR_API_KEY=… portta host serve" status={status.linear} />
      </CardBody>
    </Card>
  )
}
