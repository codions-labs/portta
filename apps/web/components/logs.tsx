'use client'

import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { LogsResponse, ProjectLogSource } from 'portta-contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/utils.ts'
import { useLogStream } from '../lib/ws.ts'
import { CopyButton } from './copy.tsx'
import { Empty, ErrorBox, Loading } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Input, Select } from './ui/field.tsx'

interface ViewerLine {
  stream: 'stdout' | 'stderr'
  timestamp: string | null
  text: string
  service?: string
}

interface ViewerResponse extends Omit<LogsResponse, 'containerId' | 'name' | 'lines'> {
  lines: ViewerLine[]
  sources?: ProjectLogSource[]
  ordered?: boolean
}

/**
 * A service name is painted from a neutral set, never from the semantic
 * tones: stderr is red because it means something, and an origin that
 * happened to hash to red would say the same thing by accident.
 */
const ORIGIN_TONES = ['text-accent', 'text-info', 'text-agent', 'text-ink', 'text-muted', 'text-subtle'] as const

export function originTone(service: string): string {
  let hash = 0
  for (let index = 0; index < service.length; index += 1) {
    hash = (hash * 31 + service.charCodeAt(index)) | 0
  }
  return ORIGIN_TONES[Math.abs(hash) % ORIGIN_TONES.length]!
}

export function LogViewer({
  queryKey,
  load,
  className,
  sources,
  showOrigin = false,
  selectedService,
  onSelectService,
  stream,
}: {
  queryKey: readonly unknown[]
  load: (tail: number) => Promise<ViewerResponse>
  className?: string
  sources?: ProjectLogSource[]
  showOrigin?: boolean
  selectedService?: string | null
  onSelectService?: (service: string | null) => void
  /**
   * The environment to follow live, when there is one.
   *
   * With this the viewer holds one socket and receives what Docker sends;
   * without it, and whenever the socket will not stay up, it polls for the
   * last lines instead.
   */
  stream?: { environment: string } | undefined
}) {
  const { t } = useTranslation('common')
  const [tail, setTail] = useState(200)
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(false)

  const live = useLogStream(stream?.environment ?? null, selectedService ?? null, {
    enabled: follow && stream !== undefined,
    tail,
  })
  // Polling is what following meant before, and it is what following means
  // again the moment the socket gives up.
  const polling = follow && (stream === undefined || live.state === 'failed')

  const query = useQuery({
    queryKey: [...queryKey, tail],
    queryFn: () => load(tail),
    refetchInterval: polling ? 3000 : false,
  })

  const lines = useMemo(() => {
    // The loaded tail first, then whatever arrived on the socket after it.
    const all = [...(query.data?.lines ?? []), ...live.lines]
    if (filter.trim() === '') return all
    const needle = filter.toLowerCase()
    return all.filter((line) => line.text.toLowerCase().includes(needle))
  }, [query.data, live.lines, filter])

  const asText = useMemo(
    () => lines.map((line) => (line.service ? `${line.service} | ${line.text}` : line.text)).join('\n'),
    [lines],
  )

  const gutter = showOrigin ? Math.min(Math.max(...lines.map((line) => line.service?.length ?? 0), 0), 18) : 0

  const reported = query.data?.sources ?? []
  const failed = reported.filter((source) => source.error !== null)
  const notRunning = reported.filter((source) => source.error === null && source.state !== 'running')
  const approximateOrder = query.data?.ordered === false

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        {sources && onSelectService ? (
          <Select
            value={selectedService ?? ''}
            onChange={(event) => onSelectService(event.target.value === '' ? null : event.target.value)}
            size="sm"
            className="w-44"
            aria-label={t('logs.service')}
          >
            <option value="">{t('logs.allServices')}</option>
            {sources.map((source) => (
              <option key={source.containerId} value={source.service}>
                {source.service}
                {source.state === 'running' ? '' : ` (${source.state})`}
              </option>
            ))}
          </Select>
        ) : null}
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('logs.filterLines')}
          size="sm"
          className="w-48"
          aria-label={t('logs.filterLogLines')}
        />
        <Select
          value={String(tail)}
          onChange={(event) => setTail(Number(event.target.value))}
          size="sm"
          className="w-28"
          aria-label={t('logs.numberOfLines')}
        >
          <option value="100">100 {t('logs.lines')}</option>
          <option value="200">200 {t('logs.lines')}</option>
          <option value="500">500 {t('logs.lines')}</option>
          <option value="1000">1000 {t('logs.lines')}</option>
        </Select>
        <Button
          size="sm"
          variant={follow ? 'primary' : 'default'}
          onClick={() => {
            if (follow) live.reset()
            setFollow((value) => !value)
          }}
          title={polling ? t('logs.refreshEvery3s') : t('logs.liveStream')}
        >
          <RefreshCw className={cn(follow && polling && 'animate-spin')} />
          {follow ? t('following') : t('follow')}
        </Button>
        {follow && live.state === 'retrying' ? (
          <span role="status" className="text-2xs text-warn">
            {t('logs.reconnecting')}
          </span>
        ) : null}
        <Button size="sm" onClick={() => void query.refetch()}>
          {t('refresh')}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-subtle">{t('logs.lineCount', { count: lines.length })}</span>
          <CopyButton value={asText} label={t('copyLog')} />
        </div>
      </div>

      {sources && (failed.length > 0 || notRunning.length > 0 || approximateOrder) ? (
        <div
          role="status"
          aria-label={t('logs.logSources')}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs"
        >
          {failed.map((source) => (
            <span key={source.containerId} className="flex items-center gap-1.5">
              <Badge tone="danger">{source.service}</Badge>
              <span className="text-subtle">{source.error}</span>
            </span>
          ))}
          {notRunning.map((source) => (
            <span key={source.containerId} className="flex items-center gap-1.5">
              <Badge tone="warn">{source.service}</Badge>
              <span className="text-subtle">{source.state}</span>
            </span>
          ))}
          {approximateOrder ? <span className="text-subtle">{t('logs.approximateOrder')}</span> : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-surface-2/50 scroll-thin">
        {query.isPending ? <Loading label={t('logs.readingLogs')} /> : null}
        {query.error ? (
          <div className="p-3">
            <ErrorBox error={query.error} />
          </div>
        ) : null}
        {query.data && lines.length === 0 ? <Empty title={filter ? t('logs.noMatch') : t('logs.noOutput')} /> : null}
        {lines.length > 0 ? (
          <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {lines.map((line, index) => (
              <div key={index} className={line.stream === 'stderr' ? 'text-danger' : 'text-ink/90'}>
                {showOrigin && line.service ? (
                  <span className={cn('mr-2 inline-block', originTone(line.service))}>
                    {line.service.padEnd(gutter, ' ').slice(0, gutter)} |
                  </span>
                ) : null}
                {line.timestamp ? <span className="mr-2 text-subtle">{line.timestamp.slice(11, 19)}</span> : null}
                {line.text}
              </div>
            ))}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
