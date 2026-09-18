'use client'

import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { iconButton } from '@/components/ui/surfaces'
import { buildTranscriptItems } from '../../lib/transcript.ts'
import type { RunDetailResponse, TranscriptEntry } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { RunStatusBadge } from './run-status-badge.tsx'

interface ExecutionTranscriptProps {
  execution: RunDetailResponse['run']['executions'][number]
  entries: TranscriptEntry[]
  loading: boolean
  onClose: () => void
}

function json(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

const block = 'rounded-md border border-line bg-surface-2/60'
const pre = 'overflow-auto whitespace-pre-wrap border-t border-line p-3 font-mono text-2xs'

export function ExecutionTranscript({ execution, entries, loading, onClose }: ExecutionTranscriptProps) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'transcript' })
  const items = buildTranscriptItems(entries)

  return (
    <section className="flex min-h-0 flex-1 flex-col border-l border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink">{execution.label}</h3>
          <p className="truncate text-2xs text-subtle">
            {execution.provider ?? execution.harness}
            {execution.model ? ` · ${execution.model}` : ''}
          </p>
        </div>
        <RunStatusBadge status={execution.status} />
        <button type="button" className={iconButton} aria-label={t('close')} onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
        {execution.input !== null ? (
          <details className={cn(block, 'mb-4')}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink">{t('input')}</summary>
            <pre className={cn(pre, 'max-h-56 text-muted')}>{json(execution.input)}</pre>
          </details>
        ) : null}
        {execution.output !== null ? (
          <details className={cn(block, 'mb-4')} open>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink">{t('output')}</summary>
            <pre className={cn(pre, 'max-h-72 text-ink')}>{json(execution.output)}</pre>
          </details>
        ) : null}
        {execution.error ? (
          <p className="mb-4 whitespace-pre-wrap rounded-md border border-danger/35 bg-danger/6 px-3 py-2 text-xs text-danger">
            {execution.error}
          </p>
        ) : null}
        {loading && items.length === 0 ? (
          <p className="text-sm text-subtle">{t('loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-subtle">{t('empty')}</p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              if (item.type === 'prompt')
                return (
                  <article
                    className="ml-auto max-w-[88%] whitespace-pre-wrap rounded-lg border border-accent/35 bg-accent/6 px-3 py-2 text-sm text-ink"
                    key={item.key}
                  >
                    {item.text}
                  </article>
                )
              if (item.type === 'text')
                return (
                  <article className="max-w-[92%] whitespace-pre-wrap text-sm leading-6 text-ink" key={item.key}>
                    {item.text}
                  </article>
                )
              if (item.type === 'reasoning')
                return (
                  <details className="border-l-2 border-line pl-3 text-xs text-subtle" key={item.key}>
                    <summary className="cursor-pointer select-none py-1">{t('reasoning')}</summary>
                    <div className="whitespace-pre-wrap pb-1 leading-5">{item.text}</div>
                  </details>
                )
              if (item.type === 'tool')
                return (
                  <details className={block} open={item.failed} key={item.key}>
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-ink">
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-auto text-subtle">
                        {item.running ? t('toolRunning') : item.failed ? t('toolFailed') : t('toolCompleted')}
                      </span>
                    </summary>
                    {item.input !== undefined && item.input !== null ? (
                      <pre className={cn(pre, 'max-h-56 text-muted')}>{json(item.input)}</pre>
                    ) : null}
                    {item.output ? (
                      <pre className={cn(pre, 'max-h-72', item.failed ? 'text-danger' : 'text-ink')}>{item.output}</pre>
                    ) : null}
                  </details>
                )
              if (item.type === 'status' && item.state === 'failed' && item.error)
                return (
                  <p
                    className="rounded-md border border-danger/35 bg-danger/6 px-3 py-2 text-xs text-danger"
                    key={item.key}
                  >
                    {item.error}
                  </p>
                )
              return null
            })}
          </div>
        )}
      </div>
    </section>
  )
}
