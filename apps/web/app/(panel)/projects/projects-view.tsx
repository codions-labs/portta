'use client'

// Every Project on this panel with its environments, or as a table to act on
// several at once.
//
// The server read the list for this render and passed it in, so the first paint
// is the list. From there the query owns it: the interval refetches, and
// `lib/live.ts` invalidates when Docker says something changed.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { DevelopmentOverview, Environment, ProjectSummary } from 'portta-contracts'
import { slug as slugify } from 'portta-core/browser'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProjectTable } from '@/components/entities/project-table'
import { ProjectGroup, UnownedGroup } from '@/components/projects/project-group'
import { ProjectsSections, VIEW_STORAGE } from '@/components/projects/projects-sections'
import {
  Empty,
  ErrorBox,
  FilterChip,
  PageHeader,
  SkeletonRows,
  ToolbarSearch,
  ViewToolbar,
} from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { ColumnsMenu, useTableArrangement } from '@/components/ui/table-arrangement'
import { ApiError, api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import {
  DEFAULT_PROJECT_FILTERS,
  defaultProjectOrder,
  groupProjects,
  hasFolders,
  hasUnpushedCode,
  matchesProjectFilters,
  type ProjectFilters,
  type ProjectGrouping,
  type ProjectView,
  projectState,
  resolveProjectView,
  tagCounts,
  tagKeys,
  toListItems,
} from '@/lib/projects'
import {
  keys,
  useDevelopmentOverview,
  useEnvironments,
  useExposure,
  useMetricsCurrent,
  useProjects,
} from '@/lib/queries'
import { useDiscoveredFolders } from '@/lib/queries/projects'

export function ProjectsView({
  initialProjects,
  initialOverview,
  startCreating = false,
}: {
  initialProjects: ProjectSummary[]
  initialOverview: DevelopmentOverview
  /** Arrived from an "Add project" elsewhere in the panel. */
  startCreating?: boolean
}) {
  const { t } = useTranslation('projects')
  const [filters, setFilters] = useState<ProjectFilters>(DEFAULT_PROJECT_FILTERS)
  const [creating, setCreating] = useState(startCreating)
  const [grouping, setGrouping] = useState<ProjectGrouping>('none')
  // Cards until the browser has read its storage: the server cannot know the
  // preference, and a first render that disagrees with its HTML is thrown
  // away and rebuilt, which costs more than the re-render nobody sees.
  const [view, setView] = useState<ProjectView>('cards')
  useEffect(() => {
    try {
      setView(resolveProjectView(localStorage.getItem(VIEW_STORAGE)))
    } catch {
      /* private browsing */
    }
  }, [])
  // The list as it was left: search, tag and grouping live in the address, so a reload or a shared link
  // shows the same list. Read after the first render for the reason the view is.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try {
      const query = new URLSearchParams(window.location.search)
      const q = query.get('q')
      const tag = query.get('tag')
      const group = query.get('group')
      if (q !== null || tag !== null) {
        setFilters((current) => ({ ...current, search: q ?? current.search, tag: tag ?? current.tag }))
      }
      if (group === 'state' || group === 'folder' || group?.startsWith('tag:')) setGrouping(group as ProjectGrouping)
    } catch {
      /* no address to read */
    }
    setRestored(true)
  }, [])
  useEffect(() => {
    if (!restored) return
    try {
      const url = new URL(window.location.href)
      const write = (key: string, value: string | null) =>
        value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
      write('q', filters.search.trim() || null)
      write('tag', filters.tag)
      write('group', grouping === 'none' ? null : grouping)
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {
      /* the list works without an address */
    }
  }, [restored, filters.search, filters.tag, grouping])
  const catalog = useProjects(initialProjects)
  const overview = useDevelopmentOverview(initialOverview)
  const environments = useEnvironments(true)
  const mayCreate = useCan('project:create')
  const exposure = useExposure(useCan('access:read'))
  const metrics = useMetricsCurrent()
  const discovered = useDiscoveredFolders(useCan('settings:read'))

  const catalogUnavailable = catalog.error instanceof ApiError && catalog.error.status === 503

  const items = useMemo(
    () => toListItems(catalog.data ?? [], overview.data?.projects).sort(defaultProjectOrder),
    [catalog.data, overview.data],
  )
  // The environments whose code is not committed or not pushed, as the host collector read it.
  const unpushed = useMemo(
    () =>
      new Set(
        (metrics.data?.projects ?? [])
          .filter(
            (project) =>
              project.git && (project.git.changed + project.git.untracked > 0 || (project.git.ahead ?? 0) > 0),
          )
          .map((project) => project.composeProject),
      ),
    [metrics.data],
  )
  const shown = useMemo(
    () => items.filter((item) => matchesProjectFilters(item, filters, unpushed)),
    [items, filters, unpushed],
  )
  const tags = useMemo(() => tagCounts(items), [items])
  const keysInUse = useMemo(() => tagKeys(items), [items])
  // A grouping by a key nobody uses any more is no grouping.
  const folders = useMemo(() => hasFolders(items), [items])
  const effective: ProjectGrouping =
    (grouping.startsWith('tag:') && !keysInUse.includes(grouping.slice(4))) || (grouping === 'folder' && !folders)
      ? 'none'
      : grouping
  const bands = useMemo(
    () =>
      groupProjects(shown, effective, {
        state: (state) => t(`state.${state}`),
        without: (key) => t('group.without', { key }),
        noFolder: t('group.noFolder'),
        pinned: t('group.pinned'),
        others: t('group.others'),
      }),
    [shown, effective, t],
  )
  const known = useMemo(
    () =>
      new Map((environments.data ?? []).map((environment): [string, Environment] => [environment.name, environment])),
    [environments.data],
  )
  // What this host runs and no Project adopted. A filter on a Project's state
  // says nothing about these, so only the search narrows them.
  const unowned = useMemo(() => {
    const owned = new Set(items.flatMap((item) => item.environments.map((environment) => environment.name)))
    const needle = filters.search.trim().toLowerCase()
    return (environments.data ?? []).filter(
      (environment) =>
        !owned.has(environment.name) &&
        !environment.overrides?.archived &&
        (needle === '' || environment.name.toLowerCase().includes(needle)),
    )
  }, [items, environments.data, filters.search])
  const counts = {
    problem: items.filter((item) => ['unhealthy', 'partial'].includes(projectState(item))).length,
    idle: items.filter((item) => projectState(item) === 'idle').length,
    unpushed: items.filter((item) => hasUnpushedCode(item, unpushed)).length,
    archived: items.filter((item) => item.archived).length,
  }

  const set = <Key extends keyof ProjectFilters>(key: Key, value: ProjectFilters[Key]) =>
    setFilters((current) => ({ ...current, [key]: value }))

  const table = useTableArrangement('projects')

  if (catalog.error && !catalogUnavailable) return <ErrorBox error={catalog.error} />

  // One row of controls, in one place, whichever shape the list takes: the
  // two views are the same page in two shapes rather than two pages.
  const controls = (
    <>
      <ToolbarSearch
        value={filters.search}
        onChange={(event) => set('search', event.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchAria')}
      />
      <FilterChip active={filters.state === 'all'} onClick={() => set('state', 'all')}>
        {t('filters.all')}
      </FilterChip>
      {counts.problem > 0 ? (
        <FilterChip active={filters.state === 'problem'} onClick={() => set('state', 'problem')}>
          {t('filters.problem', { count: counts.problem })}
        </FilterChip>
      ) : null}
      {counts.unpushed > 0 ? (
        <FilterChip active={filters.state === 'unpushed'} onClick={() => set('state', 'unpushed')}>
          {t('filters.unpushed', { count: counts.unpushed })}
        </FilterChip>
      ) : null}
      {counts.idle > 0 ? (
        <FilterChip active={filters.state === 'idle'} onClick={() => set('state', 'idle')}>
          {t('filters.idle', { count: counts.idle })}
        </FilterChip>
      ) : null}
      {counts.archived > 0 ? (
        <FilterChip active={filters.state === 'archived'} onClick={() => set('state', 'archived')}>
          {t('filters.archived', { count: counts.archived })}
        </FilterChip>
      ) : null}
    </>
  )

  const tagChips =
    tags.length > 0 || folders ? (
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('tagsAria')}>
        {tags.length > 0 ? (
          <>
            <FilterChip active={filters.tag === null} onClick={() => set('tag', null)}>
              {t('filters.allTags')}
            </FilterChip>
            {tags.map((tag) => (
              <FilterChip key={tag.label} active={filters.tag === tag.label} onClick={() => set('tag', tag.label)}>
                {tag.label} {tag.count}
              </FilterChip>
            ))}
          </>
        ) : null}
        <span className="ml-2 text-xs font-semibold text-muted">{t('group.by')}</span>
        <Segmented
          label={t('group.by')}
          value={effective}
          onChange={setGrouping}
          options={[
            { value: 'none', label: t('group.none') },
            ...(folders ? [{ value: 'folder' as const, label: t('group.folder') }] : []),
            ...keysInUse.map((key) => ({
              value: `tag:${key}` as const,
              label: key.charAt(0).toUpperCase() + key.slice(1),
            })),
            { value: 'state', label: t('group.state') },
          ]}
        />
      </div>
    ) : null

  const emptyState =
    items.length === 0 ? (
      <Empty
        title={t('catalogEmpty')}
        hint={t('catalogEmptyHint')}
        action={
          mayCreate ? (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              {t('newProject')}
            </Button>
          ) : undefined
        }
      />
    ) : (
      <Empty
        title={t('noMatch')}
        hint={t('noMatchHint')}
        action={
          <Button size="sm" onClick={() => setFilters(DEFAULT_PROJECT_FILTERS)}>
            {t('filters.anyState')}
          </Button>
        }
      />
    )

  const chrome = (
    <ViewToolbar
      trailing={
        <>
          {view === 'table' ? <ColumnsMenu arrangement={table} /> : null}
          <ProjectsSections active={view} onChoose={setView} />
        </>
      }
    >
      {controls}
    </ViewToolbar>
  )

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('catalogDescription')}
        actions={
          /* Hidden rather than disabled: a control that is never available to
             this role is noise, not a hint. The API refuses it regardless. */
          mayCreate ? (
            <Button variant="primary" disabled={catalogUnavailable} onClick={() => setCreating(true)}>
              <Plus />
              {t('newProject')}
            </Button>
          ) : undefined
        }
      />

      <section className="mb-6">
        {chrome}
        {tagChips}
        {catalog.isPending ? (
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        ) : catalogUnavailable ? (
          <Card>
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          </Card>
        ) : view === 'table' ? (
          <Card>
            <ProjectTable items={shown} arrangement={table} empty={emptyState} />
          </Card>
        ) : (
          <div className="space-y-4">
            {shown.length === 0 && (unowned.length === 0 || filters.state !== 'all') ? <Card>{emptyState}</Card> : null}
            {bands.map((band) => (
              <section key={band.id} className="space-y-4" aria-label={band.title ?? undefined}>
                {band.title ? (
                  <h2 className="flex items-baseline gap-2 pt-1 text-sm font-semibold text-ink">
                    {band.title}
                    <span className="text-xs font-normal text-subtle tabular-nums">{band.items.length}</span>
                  </h2>
                ) : null}
                {band.items.map((item) => (
                  <ProjectGroup key={item.slug} item={item} environments={known} exposure={exposure.data} />
                ))}
              </section>
            ))}
            {filters.state === 'all' && unowned.length > 0 ? (
              <UnownedGroup
                environments={unowned}
                projects={catalog.data ?? []}
                exposure={exposure.data}
                home={discovered.data?.home}
              />
            ) : null}
          </div>
        )}
      </section>

      {creating && mayCreate ? <CreateProjectDialog open onOpenChange={setCreating} /> : null}
    </>
  )
}

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        name: name.trim(),
        slug: slug.trim() === '' ? slugify(name) : slug.trim(),
        description: description.trim() === '' ? null : description.trim(),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      onOpenChange(false)
      router.push(`/projects/${encodeURIComponent(created.slug)}`)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title')}
      description={t('create.description')}
      footer={
        <Button
          variant="primary"
          size="sm"
          busy={create.isPending}
          disabled={name.trim() === ''}
          onClick={() => create.mutate()}
        >
          {t('create.create')}
        </Button>
      }
    >
      {create.error ? <ErrorBox error={create.error} /> : null}
      <div className="space-y-3">
        <Field label={t('create.name')}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={t('create.name')}
            />
          )}
        </Field>
        <Field label={t('create.slug')} hint={t('create.slugHint')}>
          {(id) => (
            <Input
              id={id}
              mono
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={name.trim() === '' ? 'demo-shop' : slugify(name)}
              aria-label={t('create.slug')}
            />
          )}
        </Field>
        <Field label={t('create.descriptionLabel')}>
          {(id) => (
            <Input
              id={id}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-label={t('create.descriptionLabel')}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
