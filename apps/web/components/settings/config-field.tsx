'use client'

import type { ConfigField as ConfigFieldView } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { CodeChip } from '../copy.tsx'
import { DocText } from '../doc-text.tsx'
import { ValueArrow } from '../pending-diff.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Field, Input, Select } from '../ui/field.tsx'
import { Switch } from '../ui/switch.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

/**
 * One setting, and everything a person needs before changing it: what it is,
 * what it does, what it is set to, and — only when it matters — whether the
 * running process has caught up.
 */
export function ConfigField({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: ConfigFieldView
  value: string
  onChange: (value: string | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  const boolean = field.kind === 'boolean'
  const on = value === 'true'
  const current = field.secret
    ? field.isSet
      ? tc('set')
      : tc('notSet')
    : boolean
      ? on
        ? tc('enabled')
        : tc('disabled')
      : (field.runtimeValue ?? tc('notSet'))

  const source =
    field.isSet || field.secret
      ? null
      : field.valueSource === 'detected'
        ? t('valueDetected')
        : field.valueSource === 'default'
          ? t('valueDefault')
          : field.valueSource === 'environment'
            ? t('valueEnvironment')
            : field.valueSource === 'derived'
              ? t('valueDerived')
              : null

  const label = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {t(`fields.${field.key}.label`, { defaultValue: field.label })}
      {field.pending ? (
        <Tooltip label={t('pendingHint', { value: field.runtimeValue ?? tc('notSet') })}>
          <span tabIndex={0} className="rounded-xs focus-ring">
            <Badge tone="warn" dot>
              {tc('pendingRestart')}
            </Badge>
          </span>
        </Tooltip>
      ) : null}
    </span>
  )

  const hint = (
    <>
      <DocText citationLabel={t('learnMore')}>{t(`fields.${field.key}.help`, { defaultValue: field.help })}</DocText>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-2xs">
        {source ? <span>{source}</span> : null}
        {field.pending && !field.secret ? (
          <ValueArrow
            from={boolean ? (field.runtimeValue === 'true' ? tc('enabled') : tc('disabled')) : field.runtimeValue}
            to={boolean ? (field.value === 'true' ? tc('enabled') : tc('disabled')) : field.value}
          />
        ) : null}
        <CodeChip tone="muted" title={t('envVar')}>
          {field.key}
        </CodeChip>
      </span>
    </>
  )

  if (boolean) {
    return (
      <Field id={field.key} label={label} hint={hint} inline>
        <span className="flex items-center gap-2">
          <span className="text-xs text-subtle">{current}</span>
          <Switch
            id={field.key}
            checked={on}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        </span>
      </Field>
    )
  }

  return (
    <Field id={field.key} label={label} hint={hint}>
      {field.kind === 'choice' ? (
        <Select
          id={field.key}
          size="sm"
          className="w-full max-w-md"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {t(`fields.${field.key}.choices.${choice}`, { defaultValue: choice })}
            </option>
          ))}
        </Select>
      ) : field.secret ? (
        <span className="flex max-w-md items-center gap-2">
          <Input
            id={field.key}
            size="sm"
            type="password"
            autoComplete="off"
            disabled={disabled}
            mono
            placeholder={field.isSet ? tc('unchanged') : tc('notSet')}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <Badge tone={field.isSet ? 'ok' : 'neutral'}>{field.isSet ? tc('set') : tc('unset')}</Badge>
          {field.isSet ? (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
              {tc('clear')}
            </Button>
          ) : null}
        </span>
      ) : (
        <Input
          id={field.key}
          size="sm"
          className="max-w-md"
          mono={field.kind === 'string'}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
