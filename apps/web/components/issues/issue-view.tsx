'use client'

// One issue: what it says, what was said about it, and what is running for it.
//
// Every write goes to the provider and answers with the issue as the provider
// now has it, so the page never keeps a version of its own: the answer replaces
// the cache entry, and the lists that showed this issue are invalidated with it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { Issue, IssueComment, Project } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Loading, SectionHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { useToast } from '@/components/ui/toast'
import { api, type PatchIssueInput } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useIssue, useIssueVocabulary } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'
import { EditableTitle } from './editable-title.tsx'
import { IssueStateBadge } from './issue-badges.tsx'
import { IssueProperties } from './issue-properties.tsx'
import { canStartIssueRun } from './issue-run.ts'
import { IssueTrouble } from './issue-trouble.tsx'
import { MarkdownEditor } from './markdown-editor.tsx'
import { MarkdownView } from './markdown-view.tsx'
import { useProviderName } from './provider.ts'
import { StartIssueRunDialog } from './start-issue-run-dialog.tsx'

export function IssueView({ project, issueRef, readOnly }: { project: Project; issueRef: string; readOnly: boolean }) {
  const { t } = useTranslation('issues')
  const { t: tn } = useTranslation('nav')
  const queryClient = useQueryClient()
  const toast = useToast()
  const providerName = useProviderName()
  const mayWrite = useCan('issue:write', project.id) && !readOnly
  const issue = useIssue(project.slug, issueRef)
  const vocabulary = useIssueVocabulary(project.slug, mayWrite)
  const [editingBody, setEditingBody] = useState(false)
  const [bodyDraft, setBodyDraft] = useState('')
  const [starting, setStarting] = useState(false)
  const runContext = useQuery({
    queryKey: keys.issueRunContext(project.slug, issueRef),
    queryFn: () => api.issueRunContext(project.slug, issueRef),
    staleTime: 15_000,
    retry: false,
    enabled: mayWrite,
  })

  const base = `/projects/${encodeURIComponent(project.slug)}`
  const crumbs = (key?: string): BreadcrumbItem[] => [
    { label: tn('projects'), href: '/projects' },
    { label: project.name, href: base },
    { label: t('heading'), href: `${base}/issues` },
    { label: key ?? issueRef },
  ]

  /** A write answers with the whole issue, so the cache takes it and the lists refresh. */
  const settle = (updated: Issue) => {
    queryClient.setQueryData(keys.issue(project.slug, issueRef), updated)
    // The lists, but not this issue: the answer just written is newer than
    // anything a refetch would bring back, and it cost a provider call already.
    void queryClient.invalidateQueries({
      queryKey: ['issues', project.slug],
      predicate: (query) => query.queryKey[2] !== 'one',
    })
    void queryClient.invalidateQueries({ queryKey: keys.activity(project.slug) })
    void queryClient.invalidateQueries({ queryKey: keys.developmentOverview() })
  }
  const failed = (error: unknown) => {
    toast.push({
      title: t('failed'),
      description: error instanceof Error ? error.message : String(error),
      tone: 'danger',
    })
  }

  const patch = useMutation({
    mutationFn: (body: PatchIssueInput) => api.patchIssue(project.slug, issueRef, body),
    onSuccess: settle,
    onError: failed,
  })
  const comment = useMutation({
    mutationFn: (body: string) => api.commentOnIssue(project.slug, issueRef, body),
    onSuccess: settle,
    onError: failed,
  })

  if (issue.error) {
    return (
      <>
        <Breadcrumb items={crumbs()} className="-ml-1 mb-3" />
        <IssueTrouble error={issue.error} work={project.work} />
        <p className="mt-3">
          <Link className="rounded-xs text-sm text-accent hover:underline focus-ring" href={`${base}/issues`}>
            {t('backToIssues')}
          </Link>
        </p>
      </>
    )
  }
  if (!issue.data) return <Loading label={t('reading')} />

  const data = issue.data
  const closed = data.state === 'closed'

  return (
    <>
      <Breadcrumb items={crumbs(data.key)} className="-ml-1 mb-3" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <IssueStateBadge state={data.state} reason={data.stateReason} />
                <Mono kind="id" tone="subtle" className="text-xs">
                  {data.key}
                </Mono>
                <a
                  className="inline-flex items-center gap-1 rounded-xs text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-ring"
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-3" aria-hidden />
                  {t('openOnProvider', { provider: providerName(data.provider) })}
                </a>
                {patch.isPending ? <span className="text-xs text-subtle">{t('title.saving')}</span> : null}
              </div>
              <EditableTitle
                value={data.title}
                disabled={!mayWrite}
                pending={patch.isPending}
                onSave={(title) => patch.mutateAsync({ title })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canStartIssueRun(mayWrite, runContext.data?.available) ? (
                <Button size="sm" variant="primary" onClick={() => setStarting(true)}>
                  {t('run.cta')}
                </Button>
              ) : null}
              {mayWrite ? (
                closed ? (
                  <Button size="sm" busy={patch.isPending} onClick={() => patch.mutate({ state: 'open' })}>
                    {t('detail.reopen')}
                  </Button>
                ) : (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="sm" busy={patch.isPending}>
                        {t('detail.close')}
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => patch.mutate({ state: 'closed', stateReason: 'completed' })}>
                        {t('detail.closeCompleted')}
                      </MenuItem>
                      <MenuItem onSelect={() => patch.mutate({ state: 'closed', stateReason: 'not planned' })}>
                        {t('detail.closeNotPlanned')}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )
              ) : null}
            </div>
          </div>

          <section className="space-y-2">
            <SectionHeader
              title={t('detail.body')}
              actions={
                mayWrite && !editingBody ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setBodyDraft(data.body ?? '')
                      setEditingBody(true)
                    }}
                  >
                    {t('detail.editBody')}
                  </Button>
                ) : undefined
              }
            />
            {editingBody ? (
              <div className="space-y-2">
                <MarkdownEditor
                  value={bodyDraft}
                  onChange={setBodyDraft}
                  autoFocus
                  onEscape={() => setEditingBody(false)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    busy={patch.isPending}
                    onClick={() => {
                      patch.mutate({ body: bodyDraft })
                      setEditingBody(false)
                    }}
                  >
                    {t('detail.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingBody(false)}>
                    {t('detail.cancel')}
                  </Button>
                </div>
              </div>
            ) : data.body && data.body.trim() !== '' ? (
              <MarkdownView source={data.body} />
            ) : (
              <p className="text-sm text-subtle">{t('detail.bodyEmpty')}</p>
            )}
          </section>

          <IssueComments
            comments={data.comments}
            readOnly={!mayWrite}
            busy={comment.isPending}
            onComment={(body) => comment.mutateAsync(body)}
          />
        </div>

        <IssueProperties
          issue={data}
          projectSlug={project.slug}
          {...(vocabulary.data ? { vocabulary: vocabulary.data } : {})}
          readOnly={!mayWrite}
          onPatch={(body) => patch.mutate(body)}
        />
      </div>
      <StartIssueRunDialog project={project} issue={data} open={starting} onOpenChange={setStarting} />
    </>
  )
}

/**
 * The conversation, as the provider has it. Comments are not editable here:
 * GitHub and Linear each have their own rules about who may edit what and for
 * how long, and a panel that offered an edit it cannot guarantee would be
 * offering a refusal.
 */
function IssueComments({
  comments,
  readOnly,
  busy,
  onComment,
}: {
  comments: IssueComment[]
  readOnly: boolean
  busy: boolean
  onComment: (body: string) => Promise<unknown>
}) {
  const { t } = useTranslation('issues')
  const [draft, setDraft] = useState('')

  const send = async () => {
    if (draft.trim() === '') return
    await onComment(draft)
    setDraft('')
  }

  return (
    <section className="space-y-3">
      <SectionHeader title={t('detail.comments')} count={comments.length > 0 ? comments.length : undefined} />
      {comments.length === 0 ? (
        <p className="text-sm text-subtle">{t('detail.noComments')}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((entry) => (
            <CommentRow key={entry.id} comment={entry} />
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <div className="space-y-2">
          <MarkdownEditor value={draft} onChange={setDraft} placeholder={t('detail.commentPlaceholder')} compact />
          <Button size="sm" variant="primary" busy={busy} disabled={draft.trim() === ''} onClick={() => void send()}>
            {t('detail.comment')}
          </Button>
        </div>
      )}
    </section>
  )
}

function CommentRow({ comment }: { comment: IssueComment }) {
  const { t } = useTranslation('issues')
  const { relativeTime } = useFormat()
  return (
    <li className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-xs">
        <span className="font-medium text-ink">{comment.author?.name ?? comment.author?.login ?? '—'}</span>
        <span className="text-subtle tabular-nums">{relativeTime(comment.createdAt)}</span>
        {comment.updatedAt && comment.updatedAt !== comment.createdAt ? (
          <Badge tone="outline">{t('detail.edited')}</Badge>
        ) : null}
      </div>
      <div className="px-3 py-2">
        <MarkdownView source={comment.body} />
      </div>
    </li>
  )
}
