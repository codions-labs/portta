'use client'

import { Globe } from 'lucide-react'
import type { ProjectDomain } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { CodeChip, CopyButton, Mono } from './copy.tsx'
import { LearnMore } from './settings/learn-more.tsx'
import { Callout } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'

/**
 * What the chosen mode actually produces: the formula and a few hostnames a
 * project would get. A name is not an exposure.
 */
export function ProjectDomainCard({ domain }: { domain: ProjectDomain }) {
  const { t } = useTranslation('settings', { keyPrefix: 'projectDomain' })

  const tone = domain.problem ? 'danger' : domain.advice ? 'warn' : 'ok'
  const state = domain.problem ? t('stateBroken') : domain.advice ? t('stateLimited') : t('stateOk')

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Globe className="size-4 text-subtle" />
            <span>{t('title')}</span>
            <Badge tone={tone}>{state}</Badge>
          </span>
        }
        description={t('description')}
      />
      <CardBody>
        <p className="text-xs text-subtle">{t('formula')}</p>
        <p className="mt-1">
          <Mono kind="host" tone="ink">
            {t('formulaPattern')}
          </Mono>
        </p>
        <p className="mt-3 text-xs text-subtle">
          {t('base')}:{' '}
          <Mono kind="host" tone="ink">
            {domain.domain}
          </Mono>
        </p>

        <div className="mt-4">
          <p className="mb-1 text-xs text-subtle">{t('examples')}</p>
          <ul className="space-y-1">
            {domain.examples.map((example) => (
              <li key={example} className="flex items-center gap-2">
                <CodeChip>{example}</CodeChip>
                <CopyButton value={example} label={example} />
              </li>
            ))}
          </ul>
        </div>

        {domain.problem ? (
          <Callout tone="danger" className="mt-4">
            {domain.problem}
          </Callout>
        ) : null}

        {domain.advice ? (
          <Callout tone="warn" className="mt-2">
            {domain.advice}
          </Callout>
        ) : null}

        <p className="mt-3 text-xs text-subtle">
          {t('note')} <LearnMore citation="docs/product/concepts/addresses-and-access.md#public-access" />
        </p>
      </CardBody>
    </Card>
  )
}
