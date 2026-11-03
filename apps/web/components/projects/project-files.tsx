'use client'

// The files of a project, read-only, from the copy the host collector publishes.
//
// Nothing here opens the project's folder: the panel lists what the collector wrote and shows the
// text it holds. Files that usually carry secrets are listed and not shown.

import { ChevronDown, FileText, Folder, Lock, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Mono } from '@/components/copy'
import { Callout, Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { useProjectFile, useProjectFiles } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

interface Row {
  path: string
  name: string
  depth: number
  dir: boolean
  status: 'M' | 'A' | 'D' | 'U' | null
  ignored: boolean
  readable: string
}

/** The listing as the tree shows it: every folder that holds a file is a row of its own. */
export function treeRows(
  files: ReadonlyArray<{ path: string; kind: string; status: Row['status']; ignored: boolean; readable: string }>,
  filter: { onlyChanged: boolean; query: string },
): Row[] {
  const query = filter.query.trim().toLowerCase()
  const keep = files.filter((file) => {
    if (filter.onlyChanged && file.status === null) return false
    return query === '' || file.path.toLowerCase().includes(query)
  })
  const rows = new Map<string, Row>()
  for (const file of keep) {
    const parts = file.path.split('/')
    for (let depth = 0; depth < parts.length - 1; depth += 1) {
      const path = parts.slice(0, depth + 1).join('/')
      if (!rows.has(path))
        rows.set(path, {
          path,
          name: `${parts[depth]}/`,
          depth,
          dir: true,
          status: null,
          ignored: false,
          readable: 'omitted',
        })
    }
    const dir = file.kind === 'dir'
    rows.set(file.path, {
      path: file.path,
      name: `${parts.at(-1)}${dir ? '/' : ''}`,
      depth: parts.length - 1,
      dir,
      status: file.status,
      ignored: file.ignored,
      readable: file.readable,
    })
  }
  const ordered = [...rows.values()]
  // Folders before files at each level, then by name, so a folder stays above what is in it.
  const key = (row: Row) =>
    row.path
      .split('/')
      .map((part, index, all) => `${row.dir || index < all.length - 1 ? '0' : '1'}${part.toLowerCase()}`)
      .join('/')
  return ordered.sort((a, b) => key(a).localeCompare(key(b)))
}

const STATUS_TONE = { M: 'text-warn', A: 'text-ok', D: 'text-danger', U: 'text-info' } as const

export function ProjectFilesTab({ slug }: { slug: string }) {
  const { t } = useTranslation('projects', { keyPrefix: 'files' })
  const { relativeTime } = useFormat()
  const [environment, setEnvironment] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'diff' | 'file'>('diff')
  const listing = useProjectFiles(slug, environment)
  const rows = useMemo(
    () => treeRows(listing.data?.files ?? [], { onlyChanged, query }),
    [listing.data?.files, onlyChanged, query],
  )
  const chosen = listing.data?.files.find((file) => file.path === selected) ?? null
  const file = useProjectFile(slug, listing.data?.environment ?? null, chosen?.readable === 'text' ? selected : null)

  if (listing.isPending) return <Loading />
  if (listing.isError) return <ErrorBox error={listing.error} />
  const data = listing.data
  if (data.environment === null || data.files.length === 0) {
    return (
      <Card>
        <Empty title={t('empty')} hint={t('emptyHint')} />
      </Card>
    )
  }

  const showDiff = chosen?.diff === true && file.data?.diff && view === 'diff'
  const lines = (showDiff ? (file.data?.diff ?? '') : (file.data?.content ?? '')).replace(/\n$/, '').split('\n')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t('readOnly')}</Badge>
          {data.environments.length > 1 ? (
            <select
              aria-label={t('environment')}
              value={data.environment}
              onChange={(event) => {
                setEnvironment(event.currentTarget.value)
                setSelected(null)
              }}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-sm focus-ring"
            >
              {data.environments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          {data.branch ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Mono kind="text" tone="ink">
                {data.branch}
              </Mono>
              <ChevronDown className="size-3.5 text-subtle" aria-hidden />
            </span>
          ) : null}
          {data.head ? (
            <span className="text-sm text-muted">
              <Mono kind="text" tone="ink">
                {data.head.hash}
              </Mono>{' '}
              {relativeTime(data.head.at)}
            </span>
          ) : null}
          {data.changed + data.untracked > 0 ? (
            <Badge tone="warn">{t('uncommitted', { count: data.changed + data.untracked })}</Badge>
          ) : null}
          {(data.ahead ?? 0) > 0 ? <Badge tone="info">{t('unpushed', { count: data.ahead ?? 0 })}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={onlyChanged}
            onClick={() => setOnlyChanged((value) => !value)}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-medium focus-ring',
              onlyChanged ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface text-muted',
            )}
          >
            {t('onlyChanged')}
          </button>
          <label className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-subtle" aria-hidden />
            <Input
              size="sm"
              className="w-56 pl-8"
              placeholder={t('search')}
              aria-label={t('search')}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
      </div>

      {data.truncated ? <Callout tone="warn">{t('truncated')}</Callout> : null}

      <Card className="grid min-h-[28rem] grid-cols-1 overflow-hidden md:grid-cols-[18rem_1fr]">
        <nav
          aria-label={t('tree')}
          className="max-h-[36rem] overflow-auto border-b border-line p-2 md:border-r md:border-b-0"
        >
          {rows.length === 0 ? (
            <p className="p-3 text-sm text-subtle">{t('noMatch')}</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.path}
                type="button"
                disabled={row.dir}
                aria-current={row.path === selected ? 'true' : undefined}
                onClick={() => {
                  setSelected(row.path)
                  setView('diff')
                }}
                style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-sm focus-ring',
                  row.path === selected ? 'bg-accent text-accent-fg' : 'hover:bg-fill',
                  row.ignored && 'text-subtle',
                  row.dir && 'cursor-default font-medium',
                )}
              >
                {row.dir ? (
                  <Folder className="size-3.5 shrink-0" aria-hidden />
                ) : row.readable === 'hidden' ? (
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <FileText className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 grow truncate font-mono text-xs">{row.name}</span>
                {row.ignored ? (
                  <span className="text-2xs">{t('ignored')}</span>
                ) : row.status ? (
                  <span className={cn('text-2xs font-semibold', row.path !== selected && STATUS_TONE[row.status])}>
                    {row.status === 'U' ? 'N' : row.status}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </nav>

        <div className="min-w-0">
          {chosen === null ? (
            <p className="p-6 text-sm text-subtle">{t('pick')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Mono kind="path" tone="ink" className="truncate font-semibold">
                    {chosen.path}
                  </Mono>
                  {chosen.status ? <Badge tone="warn">{t('changedBadge')}</Badge> : null}
                </div>
                <div className="flex items-center gap-2">
                  {chosen.diff && file.data?.diff ? (
                    <Segmented
                      label={t('show')}
                      value={view}
                      onChange={setView}
                      options={[
                        { value: 'diff', label: t('showChanges') },
                        { value: 'file', label: t('showFile') },
                      ]}
                    />
                  ) : null}
                  <CopyButton value={chosen.path} label={t('copyPath')} />
                </div>
              </div>
              {chosen.readable === 'hidden' ? (
                <div className="p-4">
                  <Callout tone="warn" icon={<Lock />} title={t('hiddenTitle')}>
                    {t('hiddenBody')}
                  </Callout>
                </div>
              ) : chosen.readable !== 'text' ? (
                <p className="p-6 text-sm text-subtle">
                  {t(chosen.readable === 'omitted' ? 'omitted' : chosen.readable)}
                </p>
              ) : file.isPending ? (
                <p className="p-6 text-sm text-subtle">{t('loadingFile')}</p>
              ) : file.isError ? (
                <div className="p-4">
                  <ErrorBox error={file.error} />
                </div>
              ) : (
                <pre className="max-h-[32rem] overflow-auto py-2 font-mono text-xs leading-6">
                  {lines.map((line, index) => (
                    <div
                      key={index}
                      className={cn(
                        'flex gap-4 px-4',
                        showDiff && line.startsWith('+') && !line.startsWith('+++') && 'bg-ok-wash',
                        showDiff && line.startsWith('-') && !line.startsWith('---') && 'bg-danger-wash',
                      )}
                    >
                      <span className="w-8 shrink-0 text-right text-subtle select-none">{index + 1}</span>
                      <span className="whitespace-pre">{line}</span>
                    </div>
                  ))}
                </pre>
              )}
            </>
          )}
        </div>
      </Card>
      {selected ? <p className="text-xs text-subtle">{t('audited', { path: selected })}</p> : null}
    </div>
  )
}
