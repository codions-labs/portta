'use client'

// The issues tab: what is open where this Project's work lives.
//
// There is no board and no subtask tree here, because neither GitHub nor
// Linear would answer for them — this is a list of what the provider has, with
// the two filters a provider can actually apply, and every row is a link into
// the issue.

import { MessageSquare, Plus } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { IssueSummary, Project } from 'portta-contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { IssueAssignees, IssueLabels, IssueStateBadge } from '@/components/issues/issue-badges'
import { IssueTrouble } from '@/components/issues/issue-trouble'
import { NewIssueDialog } from '@/components/issues/new-issue-dialog'
import { useProviderName } from '@/components/issues/provider'
import { Empty, NoValue, SectionHeader, SkeletonRows, ToolbarSearch, ViewToolbar } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { Segmented } from '@/components/ui/segmented'
import { useCan } from '@/lib/permissions'
import { useIssues } from '@/lib/queries'
import type { Column } from '@/lib/table'
import { useFormat } from '@/lib/use-format'

type StateFilter = 'open' | 'closed' | 'all'

function resolveState(raw: string | null): StateFilter {
  return raw === 'closed' || raw === 'all' ? raw : 'open'
}

/** What "nothing here" means depends on which state was asked for. */
const EMPTY_TITLE = { open: 'empty.open', closed: 'empty.closed', all: 'empty.all' } as const

export function IssuesTabView({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('issues')
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const providerName = useProviderName()
  const mayWrite = useCan('issue:write', project.id) && !readOnly

  // The filters live in the URL, so a filtered list is a link somebody can
  // paste and so going into an issue and back lands on the same list.
  const state = resolveState(params.get('state'))
  const search = params.get('q') ?? ''
  const issues = useIssues(project.slug, { state, ...(search === '' ? {} : { q: search }) })
  const [creating, setCreating] = useState(false)

  // Stable, because the search box holds it across a debounce: a new function
  // on every render would restart that timer every time a query settles.
  const move = useCallback(
    (next: { state?: StateFilter; q?: string }) => {
      const query = new URLSearchParams()
      const wanted = { state: next.state ?? state, q: next.q ?? search }
      if (wanted.state !== 'open') query.set('state', wanted.state)
      if (wanted.q !== '') query.set('q', wanted.q)
      const suffix = query.toString()
      router.replace(suffix === '' ? pathname : `${pathname}?${suffix}`, { scroll: false })
    },
    [pathname, router, search, state],
  )
  const commitSearch = useCallback((q: string) => move({ q }), [move])

  return (
    <>
      {/* The tab label already says "Issues"; this line says where they come
          from, which is the part a person cannot guess. */}
      <SectionHeader
        className="mb-3"
        title={t('heading')}
        count={issues.data?.length}
        description={
          project.work.provider
            ? t('description', { provider: providerName(project.work.provider) })
            : t('descriptionUnknown')
        }
        actions={
          mayWrite && project.work.provider ? (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              {t('new')}
            </Button>
          ) : undefined
        }
      />

      <ViewToolbar
        switcher={
          <Segmented
            label={t('state.label')}
            value={state}
            onChange={(next) => move({ state: next })}
            options={[
              { value: 'open', label: t('state.open') },
              { value: 'closed', label: t('state.closed') },
              { value: 'all', label: t('state.all') },
            ]}
          />
        }
      >
        {/* Free text is GitHub's own search, so it is not offered where the
            provider would ignore it and answer the unfiltered list instead. */}
        {project.work.provider === 'github' ? <SearchBox value={search} onCommit={commitSearch} /> : null}
      </ViewToolbar>

      {issues.error ? (
        <IssueTrouble error={issues.error} work={project.work} />
      ) : issues.isPending ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : (
        <IssueTable issues={issues.data ?? []} state={state} searching={search !== ''} />
      )}

      {creating ? <NewIssueDialog project={project} open onOpenChange={setCreating} /> : null}
    </>
  )
}

/**
 * The search box, which reaches the provider rather than the rows already on
 * screen: the list is one page of issues, so filtering what arrived would
 * quietly answer for the whole repository while only looking at a hundred of
 * it. Typing is held back until it stops, so a word is one search, not five.
 */
function SearchBox({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const { t } = useTranslation('issues')
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])
  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onCommit(draft), 350)
    return () => clearTimeout(timer)
  }, [draft, value, onCommit])

  return (
    <ToolbarSearch
      value={draft}
      placeholder={t('search')}
      aria-label={t('search')}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft)
      }}
    />
  )
}

function IssueTable({ issues, state, searching }: { issues: IssueSummary[]; state: StateFilter; searching: boolean }) {
  const { t } = useTranslation('issues')
  const router = useRouter()
  const { relativeTime } = useFormat()

  const columns = useMemo<Column<IssueSummary>[]>(
    () => [
      {
        id: 'state',
        header: t('table.state'),
        pinned: true,
        sortValue: (issue) => issue.state,
        cell: (issue) => <IssueStateBadge state={issue.state} reason={issue.stateReason} />,
      },
      {
        id: 'key',
        header: t('table.key'),
        pinned: true,
        // `113` sorts as a number, `ENG-42` as text: both read naturally.
        sortValue: (issue) => Number(issue.key) || issue.key,
        cell: (issue) => (
          <a className="rounded-xs underline-offset-2 hover:underline focus-ring" href={issue.panelUrl}>
            <Mono kind="id" tone="subtle" className="text-xs">
              {issue.key}
            </Mono>
          </a>
        ),
      },
      {
        id: 'title',
        header: t('table.title'),
        pinned: true,
        sortValue: (issue) => issue.title,
        cell: (issue) => (
          <a
            className="block max-w-128 truncate rounded-xs text-sm text-ink underline-offset-2 hover:underline focus-ring"
            href={issue.panelUrl}
            title={issue.title}
          >
            {issue.title}
          </a>
        ),
      },
      {
        id: 'labels',
        header: t('table.labels'),
        priority: 2,
        sortValue: (issue) => issue.labels.map((label) => label.name).join(','),
        cell: (issue) => (issue.labels.length > 0 ? <IssueLabels labels={issue.labels} max={2} /> : <NoValue />),
      },
      {
        id: 'assignees',
        header: t('table.assignees'),
        priority: 2,
        sortValue: (issue) => issue.assignees.map((user) => user.login).join(','),
        cell: (issue) =>
          issue.assignees.length > 0 ? <IssueAssignees assignees={issue.assignees} max={2} /> : <NoValue />,
      },
      {
        id: 'comments',
        header: '',
        srHeader: t('table.comments'),
        priority: 3,
        align: 'right',
        sortValue: (issue) => issue.commentCount,
        cell: (issue) =>
          issue.commentCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-subtle tabular-nums">
              <MessageSquare className="size-3.5" aria-hidden />
              {issue.commentCount}
            </span>
          ) : (
            <NoValue />
          ),
      },
      {
        id: 'updated',
        header: t('table.updated'),
        align: 'right',
        priority: 2,
        sortValue: (issue) => issue.updatedAt,
        cell: (issue) => <span className="text-xs text-subtle tabular-nums">{relativeTime(issue.updatedAt)}</span>,
      },
    ],
    [relativeTime, t],
  )

  return (
    <DataTable
      rows={issues}
      columns={columns}
      rowKey={(issue) => issue.ref}
      rowLabel={(issue) => `${issue.key} ${issue.title}`}
      storageKey="issues"
      caption={t('table.caption')}
      onRowActivate={(issue) => router.push(issue.panelUrl)}
      empty={<Empty title={t(EMPTY_TITLE[state])} hint={searching ? t('empty.searchHint') : t('empty.hint')} />}
    />
  )
}
