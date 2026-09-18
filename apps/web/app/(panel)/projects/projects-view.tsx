'use client'

// Every Project on this panel, as cards or as a table.
//
// The server read the list for this render and passed it in, so the first paint
// is the list. From there the query owns it: the interval refetches, and
// `lib/live.ts` invalidates when Docker says something changed.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Plus, Table2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { DevelopmentOverview, ProjectSummary } from 'portta-contracts'
import { slug as slugify } from 'portta-core/browser'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProjectCard } from '@/components/entities/project-card'
import { ProjectTable } from '@/components/entities/project-table'
import {
  Empty,
  ErrorBox,
  PageHeader,
  SkeletonRows,
  ToolbarCheck,
  ToolbarSearch,
  ToolbarSelect,
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
  matchesProjectFilters,
  type ProjectFilters,
  type ProjectState,
  type ProjectView,
  resolveProjectView,
  toListItems,
} from '@/lib/projects'
import { keys, useDevelopmentOverview, useEnvironments, useProjects } from '@/lib/queries'

const VIEW_STORAGE = 'portta-projects-view'

const STATES: ProjectState[] = ['running', 'partial', 'unhealthy', 'idle', 'archived']

export function ProjectsView({
  initialProjects,
  initialOverview,
}: {
  initialProjects: ProjectSummary[]
  initialOverview: DevelopmentOverview
}) {
  const { t } = useTranslation('projects')
  const [filters, setFilters] = useState<ProjectFilters>(DEFAULT_PROJECT_FILTERS)
  const [creating, setCreating] = useState(false)
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
  const catalog = useProjects(initialProjects)
  const overview = useDevelopmentOverview(initialOverview)
  const runtimes = useEnvironments(true)
  const mayCreate = useCan('project:create')

  const catalogUnavailable = catalog.error instanceof ApiError && catalog.error.status === 503

  const items = useMemo(
    () => toListItems(catalog.data ?? [], overview.data?.projects).sort(defaultProjectOrder),
    [catalog.data, overview.data],
  )
  const shown = useMemo(() => items.filter((item) => matchesProjectFilters(item, filters)), [items, filters])

  const chooseView = (next: ProjectView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE, next)
    } catch {
      /* private browsing */
    }
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
      <ToolbarSelect
        value={filters.state}
        onChange={(event) => set('state', event.target.value as ProjectFilters['state'])}
        aria-label={t('filters.state')}
      >
        <option value="all">{t('filters.anyState')}</option>
        {STATES.map((state) => (
          <option key={state} value={state}>
            {t(`state.${state}` as 'state.running')}
          </option>
        ))}
      </ToolbarSelect>
      <ToolbarCheck
        checked={filters.includeArchived}
        onChange={(event) => set('includeArchived', event.target.checked)}
      >
        {t('filters.showArchived')}
      </ToolbarCheck>
    </>
  )

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

  const switcher = (
    <Segmented
      label={t('viewLabel')}
      value={view}
      onChange={chooseView}
      options={[
        { value: 'cards', label: t('views.cards'), icon: LayoutGrid },
        { value: 'table', label: t('views.table'), icon: Table2 },
      ]}
    />
  )
  const chrome = (
    <ViewToolbar switcher={switcher} trailing={view === 'table' ? <ColumnsMenu arrangement={table} /> : null}>
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
        ) : shown.length === 0 ? (
          <Card>{emptyState}</Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((item) => (
              <ProjectCard key={item.slug} item={item} />
            ))}
          </div>
        )}
      </section>

      <p className="text-sm">
        <Link className="text-accent underline-offset-2 hover:underline" href="/environments">
          {t('environmentsLink', { count: runtimes.data?.length ?? 0 })}
        </Link>
      </p>

      {creating ? <CreateProjectDialog open onOpenChange={setCreating} /> : null}
    </>
  )
}

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
