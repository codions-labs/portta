'use client'

import type { PendingChange } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/utils.ts'
import { Mono } from './copy.tsx'
import { Button } from './ui/button.tsx'

const TRUNCATE = 48

function clip(value: string): { shown: string; title?: string } {
  if (value.length <= TRUNCATE) return { shown: value }
  return { shown: `${value.slice(0, TRUNCATE)}…`, title: value }
}

function SecretSide({ set, changed }: { set: boolean; changed?: boolean }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'apply' })
  if (!set) return <span className="text-subtle">{t('secretUnset')}</span>
  return <span>{changed ? t('secretChanged') : t('secretSet')}</span>
}

export function ValueArrow({
  from,
  to,
  secret = false,
  fromSet = false,
  toSet = false,
  className,
}: {
  from: string | null
  to: string | null
  secret?: boolean
  fromSet?: boolean
  toSet?: boolean
  className?: string
}) {
  const { t: tc } = useTranslation('common')
  const left = from === null || from === '' ? null : clip(from)
  const right = to === null || to === '' ? null : clip(to)

  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-baseline gap-1.5', className)}>
      {secret ? (
        <>
          <SecretSide set={fromSet} />
          <span className="text-subtle">→</span>
          <SecretSide set={toSet} changed={fromSet && toSet} />
        </>
      ) : (
        <>
          <Mono kind="text" tone="muted" title={left?.title} className="min-w-0 max-w-full truncate">
            {left?.shown ?? tc('notSet')}
          </Mono>
          <span className="text-subtle">→</span>
          <Mono kind="text" tone="ink" title={right?.title} className="min-w-0 max-w-full truncate">
            {right?.shown ?? tc('notSet')}
          </Mono>
        </>
      )}
    </span>
  )
}

export function PendingDiff({
  changes,
  onDiscard,
  discarding = false,
}: {
  changes: PendingChange[]
  onDiscard?: (key: string) => void
  discarding?: boolean
}) {
  const { t } = useTranslation('gateway', { keyPrefix: 'apply' })
  const { t: ts } = useTranslation('settings')
  if (changes.length === 0) return null

  return (
    <ul className="mb-3 space-y-2">
      {changes.map((change) => (
        <li key={change.key} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-ink">{ts(`fields.${change.key}.label`, { defaultValue: change.label })}</div>
            <ValueArrow
              className="mt-0.5 text-xs"
              from={change.from}
              to={change.to}
              secret={change.secret}
              fromSet={change.fromSet}
              toSet={change.toSet}
            />
          </div>
          {onDiscard ? (
            <Button size="xs" variant="ghost" disabled={discarding} onClick={() => onDiscard(change.key)}>
              {t('discard')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
