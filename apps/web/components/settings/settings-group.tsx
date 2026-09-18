'use client'

import type { ConfigField as ConfigFieldView } from 'portta-contracts'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { ConfigField } from './config-field.tsx'
import { GroupIntro } from './learn-more.tsx'

export function SettingsGroup({
  name,
  fields,
  valueFor,
  onChange,
  title,
  after,
}: {
  name: string
  fields: ConfigFieldView[]
  valueFor: (field: ConfigFieldView) => string
  onChange: (key: string, value: string | null) => void
  title?: string
  after?: ReactNode
}) {
  const { t } = useTranslation('settings')

  return (
    <Card className="min-w-0 flex-1">
      <CardHeader
        title={title ?? t(`groups.${name}`, { defaultValue: name })}
        description={<GroupIntro name={name} />}
      />
      <CardBody className="divide-y divide-line-subtle py-0">
        {fields.map((field) => (
          <div key={field.key} className="py-3 first:pt-2.5 last:pb-2.5">
            <ConfigField field={field} value={valueFor(field)} onChange={(value) => onChange(field.key, value)} />
          </div>
        ))}
        {after}
      </CardBody>
    </Card>
  )
}

export function SettingsSection({
  title,
  description,
  fields,
  valueFor,
  onChange,
  disabledKeys,
}: {
  title: string
  description?: string
  fields: ConfigFieldView[]
  valueFor: (field: ConfigFieldView) => string
  onChange: (key: string, value: string | null) => void
  disabledKeys?: ReadonlySet<string>
}) {
  if (fields.length === 0) return null
  return (
    <Card className="min-w-0 flex-1">
      <CardHeader title={title} description={description} />
      <CardBody className="divide-y divide-line-subtle py-0">
        {fields.map((field) => (
          <div key={field.key} className="py-3 first:pt-2.5 last:pb-2.5">
            <ConfigField
              field={field}
              value={valueFor(field)}
              onChange={(value) => onChange(field.key, value)}
              disabled={disabledKeys?.has(field.key)}
            />
          </div>
        ))}
      </CardBody>
    </Card>
  )
}
