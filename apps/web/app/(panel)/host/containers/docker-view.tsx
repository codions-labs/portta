'use client'

// Everything Docker is running here, whoever started it. Selecting is how several
// are handled at once; Portta's own cannot be selected, because without them the
// panel and every site go down.

import type { ContainerSummary, Ownership } from 'portta-contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContainerActions } from '@/components/container-actions'
import { Mono } from '@/components/copy'
import { ContainerBulkBar } from '@/components/entities/container-bulk'
import { ServiceDrawer } from '@/components/entities/service-drawer'
import { Empty, ErrorBox, FilterChip, Loading, ToolbarSearch, ViewToolbar } from '@/components/shell-bits'
import { containerTone } from '@/components/status'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/field'
import { useCan } from '@/lib/permissions'
import { useContainers, useDockerHost } from '@/lib/queries'
import { narrowTone } from '@/lib/tone'
import { useFormat } from '@/lib/use-format'
import { cn } from '@/lib/utils'

type Origin = 'project' | 'external' | 'portta'
type Filter = 'all' | Origin | 'conflict'

const ORIGIN: Record<Ownership, Origin> = {
  gateway: 'portta',
  integrated: 'project',
  external: 'external',
  standalone: 'external',
}
const ORIGIN_TONE = { portta: 'info', project: 'ok', external: 'neutral' } as const

const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2.4fr)_5.5rem_minmax(0,1.6fr)_minmax(0,1fr)_auto]'
const COLUMNS_SELECTABLE =
  'grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,2.4fr)_5.5rem_minmax(0,1.6fr)_minmax(0,1fr)_auto]'

export function DockerView() {
  const { t } = useTranslation('docker')
  const { t: tc } = useTranslation('common')
  const { shortImage } = useFormat()
  const mayOperate = useCan('container:operate')
  const mayRemove = useCan('container:destroy')
  const selectable = mayOperate || mayRemove
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [details, setDetails] = useState<ContainerSummary | null>(null)

  const host = useDockerHost()
  const containers = useContainers()
  const all = useMemo(() => containers.data?.containers ?? [], [containers.data])

  const conflicted = useMemo(
    () =>
      new Set(
        (host.data?.ports ?? [])
          .filter((port) => port.conflict)
          .flatMap((port) => port.bindings.map((binding) => binding.containerId)),
      ),
    [host.data],
  )

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all.filter(
      (container) =>
        (filter === 'all' ||
          (filter === 'conflict' ? conflicted.has(container.id) : ORIGIN[container.ownership] === filter)) &&
        (needle === '' ||
          [container.name, container.image, container.environment ?? '', container.service ?? '']
            .join(' ')
            .toLowerCase()
            .includes(needle)),
    )
  }, [all, conflicted, filter, search])

  if (containers.isPending) return <Loading />
  if (containers.error) return <ErrorBox error={containers.error} />

  const canPick = (container: ContainerSummary) => container.ownership !== 'gateway'
  const count = (origin: Origin) => all.filter((container) => ORIGIN[container.ownership] === origin).length
  // A container that went away since it was ticked is not selected any more.
  const selected = all.filter((container) => picked.has(container.id) && canPick(container))
  const pickable = shown.filter(canPick)
  const everyOn = pickable.length > 0 && pickable.every((container) => picked.has(container.id))
  const someOn = pickable.some((container) => picked.has(container.id))

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const toggleAll = () =>
    setPicked((current) => {
      const next = new Set(current)
      for (const container of pickable) {
        if (everyOn) next.delete(container.id)
        else next.add(container.id)
      }
      return next
    })

  const stateLine = (container: ContainerSummary) => {
    const state =
      container.completed && container.state === 'exited'
        ? tc('state.completed')
        : tc(`state.${container.state}`, { defaultValue: container.state })
    return [
      state,
      container.state === 'running' && container.health !== 'none'
        ? tc(`health.${container.health}`, { defaultValue: container.health })
        : null,
      container.restartCount > 0 ? t('table.restarts', { count: container.restartCount }) : null,
      container.state !== 'running' && container.exitCode ? t('table.exitCode', { code: container.exitCode }) : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const portsOf = (container: ContainerSummary) => {
    if (container.ports.length > 0) {
      const shownPorts = container.ports.map((port) =>
        port.ip === '0.0.0.0' || port.ip === '::' ? `:${port.hostPort}` : `${port.ip}:${port.hostPort}`,
      )
      return [...new Set(shownPorts)].join(', ')
    }
    return container.urls.length > 0 ? t('ports.viaGateway') : t('ports.none')
  }

  return (
    <div className="space-y-4">
      <ViewToolbar
        trailing={
          <ToolbarSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchAria')}
          />
        }
      >
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('chips.all', { count: all.length })}
        </FilterChip>
        <FilterChip active={filter === 'project'} onClick={() => setFilter('project')}>
          {t('chips.project', { count: count('project') })}
        </FilterChip>
        <FilterChip active={filter === 'external'} onClick={() => setFilter('external')}>
          {t('chips.external', { count: count('external') })}
        </FilterChip>
        <FilterChip active={filter === 'portta'} onClick={() => setFilter('portta')}>
          {t('chips.portta', { count: count('portta') })}
        </FilterChip>
        {conflicted.size > 0 ? (
          <FilterChip active={filter === 'conflict'} onClick={() => setFilter('conflict')}>
            <StatusDot tone="warn" label={t('chips.conflict', { count: conflicted.size })} />
            {t('chips.conflict', { count: conflicted.size })}
          </FilterChip>
        ) : null}
      </ViewToolbar>

      {selected.length > 0 ? <ContainerBulkBar selected={selected} onClear={() => setPicked(new Set())} /> : null}

      <Card>
        <div
          className={cn(
            'grid items-center gap-x-4 border-b border-line bg-surface-2 px-5 py-2 text-xs font-medium tracking-[0.06em] text-subtle uppercase',
            selectable ? COLUMNS_SELECTABLE : COLUMNS,
          )}
        >
          {selectable ? (
            <Checkbox
              checked={everyOn}
              indeterminate={someOn && !everyOn}
              disabled={pickable.length === 0}
              onChange={toggleAll}
              aria-label={t('selectAll')}
            />
          ) : null}
          <span>{t('table.name')}</span>
          <span className="hidden md:block">{t('table.origin')}</span>
          <span className="hidden md:block">{t('table.image')}</span>
          <span className="hidden md:block">{t('table.ports')}</span>
          <span className="sr-only">{t('table.actions')}</span>
        </div>

        {shown.length === 0 ? (
          <Empty title={t('empty')} />
        ) : (
          <ul aria-label={t('title')}>
            {shown.map((container) => {
              const origin = ORIGIN[container.ownership]
              const locked = !canPick(container)
              const on = !locked && picked.has(container.id)
              return (
                <li
                  key={container.id}
                  className={cn(
                    'grid items-center gap-x-4 border-t border-line px-5 py-2 transition-colors duration-100 first:border-t-0',
                    selectable ? COLUMNS_SELECTABLE : COLUMNS,
                    on ? 'bg-selection' : 'hover:bg-fill',
                  )}
                >
                  {selectable ? (
                    <span title={locked ? t('locked') : undefined} className="inline-flex">
                      <Checkbox
                        checked={on}
                        disabled={locked}
                        onChange={() => toggle(container.id)}
                        aria-label={
                          locked ? t('lockedName', { name: container.name }) : t('select', { name: container.name })
                        }
                      />
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="flex max-w-full min-w-0 items-center gap-2 rounded-xs text-left font-semibold text-ink underline-offset-2 hover:underline focus-ring"
                      onClick={() => setDetails(container)}
                    >
                      <StatusDot
                        tone={
                          container.completed
                            ? 'neutral'
                            : (narrowTone(containerTone(container.state, container.health)) as 'ok')
                        }
                        label={stateLine(container)}
                      />
                      <span className="truncate">{container.name}</span>
                    </button>
                    <span className="block truncate pl-[1.125rem] text-xs text-subtle first-letter:uppercase">
                      {stateLine(container)}
                    </span>
                  </div>
                  <div className="hidden md:block">
                    <Badge tone={ORIGIN_TONE[origin]}>{t(`origin.${origin}`)}</Badge>
                  </div>
                  <Mono
                    kind="text"
                    tone="muted"
                    className="hidden min-w-0 truncate text-xs md:block"
                    title={container.image}
                  >
                    {shortImage(container.image)}
                  </Mono>
                  <span
                    className={cn(
                      'hidden min-w-0 truncate font-mono text-xs md:block',
                      conflicted.has(container.id) ? 'font-semibold text-warn' : 'text-muted',
                    )}
                    title={conflicted.has(container.id) ? t('ports.conflict') : undefined}
                  >
                    {portsOf(container)}
                  </span>
                  <ContainerActions logsInMenu container={container} onShowDetails={() => setDetails(container)} />
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {selectable ? <p className="text-xs text-subtle">{t('footnote')}</p> : null}

      {details ? (
        <ServiceDrawer container={details} open={details !== null} onOpenChange={(open) => !open && setDetails(null)} />
      ) : null}
    </div>
  )
}
