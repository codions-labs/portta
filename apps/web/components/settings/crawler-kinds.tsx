'use client'

// The four kinds of crawler a policy talks about, said the same way wherever they appear.

import type { CrawlerPolicy } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Badge } from '@/components/ui/badge'
import { Segmented } from '@/components/ui/segmented'

export const CRAWLER_KINDS = ['search', 'train', 'live', 'preview'] as const
export type CrawlerKind = (typeof CRAWLER_KINDS)[number]

export const BLOCK_ALL: CrawlerPolicy = { search: false, train: false, live: false, preview: false }
export const NO_AI: CrawlerPolicy = { search: true, train: false, live: false, preview: true }
export const ALLOW_ALL: CrawlerPolicy = { search: true, train: true, live: true, preview: true }

export type CrawlerPreset = 'all' | 'noAi' | 'open' | 'custom'

export function presetOf(policy: CrawlerPolicy): CrawlerPreset {
  const same = (other: CrawlerPolicy) => CRAWLER_KINDS.every((kind) => policy[kind] === other[kind])
  if (same(BLOCK_ALL)) return 'all'
  if (same(NO_AI)) return 'noAi'
  if (same(ALLOW_ALL)) return 'open'
  return 'custom'
}

export const PRESET_POLICY: Record<Exclude<CrawlerPreset, 'custom'>, CrawlerPolicy> = {
  all: BLOCK_ALL,
  noAi: NO_AI,
  open: ALLOW_ALL,
}

export function CrawlerKindRows({
  policy,
  onChange,
  disabled = false,
}: {
  policy: CrawlerPolicy
  /** Absent: the rows only say what the policy is. */
  onChange?: (kind: CrawlerKind, allowed: boolean) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('settings', { keyPrefix: 'crawlers' })
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {CRAWLER_KINDS.map((kind) => (
        <li key={kind} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{t(`kinds.${kind}.title`)}</p>
            <Mono kind="text" tone="subtle" className="text-xs">
              {t(`kinds.${kind}.examples`)}
            </Mono>
          </div>
          {onChange ? (
            <Segmented
              label={t(`kinds.${kind}.title`)}
              value={policy[kind] ? 'allow' : 'block'}
              onChange={(value) => onChange(kind, value === 'allow')}
              options={[
                { value: 'block', label: t('block'), selectedClassName: 'text-ok' },
                { value: 'allow', label: t('allow'), selectedClassName: 'text-warn' },
              ]}
              className={disabled ? 'pointer-events-none opacity-60' : undefined}
            />
          ) : (
            <Badge tone={policy[kind] ? 'warn' : 'ok'}>{policy[kind] ? t('allowed') : t('blocked')}</Badge>
          )}
        </li>
      ))}
    </ul>
  )
}
