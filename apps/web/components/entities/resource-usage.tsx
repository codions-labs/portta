'use client'

import { useTranslation } from 'react-i18next'
import { bytes } from '../../lib/format.ts'
import { percentLabel, resourceBarClass, resourceTone } from '../../lib/resources.ts'
import { cn } from '../../lib/utils.ts'

/**
 * CPU, memory and disk, formatted the same way everywhere. `inline` is one
 * line of text for a row; `bar` adds a fill for a card. Anything unknown is
 * left out rather than shown as zero: zero is a measurement, absence is not.
 */
export function ResourceUsage({
  cpu,
  memoryBytes,
  memoryLimitBytes,
  diskBytes,
  variant = 'inline',
  stale = false,
  className,
}: {
  /** 0..1 */
  cpu?: number | null
  memoryBytes?: number | null
  memoryLimitBytes?: number | null
  diskBytes?: number | null
  variant?: 'inline' | 'bar'
  stale?: boolean
  className?: string
}) {
  const { t, i18n } = useTranslation('common', { keyPrefix: 'resources' })
  const cpuLabel = percentLabel(cpu ?? null)
  const memoryLabel =
    memoryBytes !== null && memoryBytes !== undefined
      ? memoryLimitBytes
        ? `${bytes(memoryBytes, i18n.language)} / ${bytes(memoryLimitBytes, i18n.language)}`
        : bytes(memoryBytes, i18n.language)
      : null
  const diskLabel = diskBytes !== null && diskBytes !== undefined ? bytes(diskBytes, i18n.language) : null
  const parts = [
    cpuLabel ? `${t('cpu')} ${cpuLabel}` : null,
    memoryLabel ? `${t('memory')} ${memoryLabel}` : null,
    diskLabel ? `${t('disk')} ${diskLabel}` : null,
  ].filter((part): part is string => part !== null)

  if (parts.length === 0) return <span className={cn('text-xs text-subtle', className)}>{t('unavailable')}</span>

  if (variant === 'inline') {
    return (
      <span
        className={cn('text-xs tabular-nums', stale ? 'text-subtle' : 'text-muted', className)}
        title={stale ? t('stale') : undefined}
      >
        {parts.join(' · ')}
      </span>
    )
  }

  const memoryRatio = memoryBytes != null && memoryLimitBytes ? memoryBytes / memoryLimitBytes : null
  return (
    <div className={cn('space-y-1.5', stale && 'opacity-70', className)} title={stale ? t('stale') : undefined}>
      {cpuLabel ? <Bar label={t('cpu')} value={cpuLabel} ratio={cpu ?? null} kind="cpu" /> : null}
      {memoryLabel ? <Bar label={t('memory')} value={memoryLabel} ratio={memoryRatio} kind="memory" /> : null}
      {diskLabel ? <Bar label={t('disk')} value={diskLabel} ratio={null} kind="storage" /> : null}
    </div>
  )
}

function Bar({
  label,
  value,
  ratio,
  kind,
}: {
  label: string
  value: string
  ratio: number | null
  kind: 'cpu' | 'memory' | 'storage'
}) {
  const tone = resourceTone(ratio, kind)
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-subtle">{label}</span>
        <span className="font-medium tabular-nums text-ink">{value}</span>
      </div>
      {ratio !== null ? (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-fill-strong" aria-hidden>
          <div
            className={cn('h-full rounded-full', resourceBarClass(tone))}
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}
