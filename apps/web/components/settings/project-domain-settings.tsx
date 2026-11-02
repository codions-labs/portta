'use client'

// How projects are named. A name opens nothing by itself: who may open it is
// decided in Access, which is why this says the result and nothing else.

import { Info } from 'lucide-react'
import type { ConfigField, ProjectDomain } from 'portta-contracts'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '../copy.tsx'
import { Callout } from '../shell-bits.tsx'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { Field, Input } from '../ui/field.tsx'
import { ConfigField as ConfigFieldControl } from './config-field.tsx'
import { LearnMore } from './learn-more.tsx'
import { OptionCard } from './option-card.tsx'
import { fieldByKey } from './values.ts'

const MODES = ['local', 'auto', 'custom'] as const

export function ProjectDomainSettings({
  fields,
  values,
  domain,
  valueFor,
  onChange,
  disabled,
  footer,
}: {
  fields: ConfigField[]
  values: Record<string, string>
  domain: ProjectDomain
  valueFor: (field: ConfigField) => string
  onChange: (key: string, value: string | null) => void
  disabled: boolean
  footer: ReactNode
}) {
  const { t } = useTranslation('settings', { keyPrefix: 'projectDomain' })
  const { t: ts } = useTranslation('settings')
  const mode = values.PORTTA_DOMAIN_MODE || domain.mode
  const custom = fieldByKey(fields, 'PORTTA_DOMAIN')
  const typed = custom ? valueFor(custom) : ''

  return (
    <Card>
      <CardHeader
        title={t('cardTitle')}
        description={t('cardDescription')}
        actions={<LearnMore citation="docs/product/concepts/addresses-and-access.md#project-addresses" />}
      />
      <CardBody className="space-y-2.5">
        <fieldset className="grid gap-2.5">
          <legend className="sr-only">{t('cardTitle')}</legend>
          {MODES.map((option) => (
            <OptionCard
              key={option}
              name="project-domain-mode"
              checked={mode === option}
              disabled={disabled}
              onSelect={() => onChange('PORTTA_DOMAIN_MODE', option)}
              title={t(`modes.${option}.title`)}
              help={t(`modes.${option}.help`)}
            />
          ))}
        </fieldset>

        {mode === 'custom' && custom ? (
          <Field
            id={custom.key}
            label={ts('fields.PORTTA_DOMAIN.label')}
            hint={
              <>
                {t('wildcardBefore')}{' '}
                <Mono kind="host" tone="ink">
                  A *.{typed || t('wildcardExample')}
                </Mono>{' '}
                {t('wildcardAfter')}
              </>
            }
          >
            <Input
              id={custom.key}
              mono
              disabled={disabled}
              value={typed}
              onChange={(event) => onChange(custom.key, event.target.value)}
            />
          </Field>
        ) : null}

        {mode === 'auto'
          ? ['PORTTA_PUBLIC_IP', 'PORTTA_AUTO_DOMAIN_PROVIDER'].map((key) => {
              const field = fieldByKey(fields, key)
              return field ? (
                <ConfigFieldControl
                  key={key}
                  field={field}
                  value={valueFor(field)}
                  disabled={disabled}
                  onChange={(value) => onChange(key, value)}
                />
              ) : null
            })
          : null}

        {domain.problem ? <Callout tone="danger">{domain.problem}</Callout> : null}
        {domain.advice ? <Callout tone="warn">{domain.advice}</Callout> : null}

        <p className="flex gap-2.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {t('preview')}{' '}
            <Mono kind="host" tone="ink" className="font-semibold whitespace-normal break-all">
              {domain.examples[0] ?? domain.domain}
            </Mono>
          </span>
        </p>
      </CardBody>
      {footer}
    </Card>
  )
}
