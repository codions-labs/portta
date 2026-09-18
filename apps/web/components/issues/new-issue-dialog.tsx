'use client'

// Opening an issue where this Project's work actually lives.
//
// The labels, assignees and milestones offered here come from the provider
// rather than from a guess: an assignee GitHub does not recognise is a refused
// write, and a picker that offered it would be the reason. When the vocabulary
// cannot be read the form still works — a title and a body are enough — and
// says so instead of pretending the repository has no labels.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { Project } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Callout } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { api } from '@/lib/api'
import { useIssueVocabulary } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { IssueTrouble } from './issue-trouble.tsx'
import { MarkdownEditor } from './markdown-editor.tsx'
import { useProviderName } from './provider.ts'

export function NewIssueDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('issues')
  const providerName = useProviderName()
  const router = useRouter()
  const queryClient = useQueryClient()
  const vocabulary = useIssueVocabulary(project.slug, open)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [assignees, setAssignees] = useState<string[]>([])
  const [milestone, setMilestone] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createIssue(project.slug, {
        title: title.trim(),
        ...(body.trim() === '' ? {} : { body }),
        ...(labels.length > 0 ? { labels } : {}),
        ...(assignees.length > 0 ? { assignees } : {}),
        ...(milestone === '' ? {} : { milestone }),
      }),
    onSuccess: (issue) => {
      void queryClient.invalidateQueries({ queryKey: ['issues', project.slug] })
      onOpenChange(false)
      router.push(issue.panelUrl)
    },
  })

  const catalog = vocabulary.data
  const provider = providerName(project.work.provider)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title')}
      description={t('create.description', { provider })}
      footer={
        <Button
          variant="primary"
          size="sm"
          busy={create.isPending}
          disabled={title.trim() === ''}
          onClick={() => create.mutate()}
        >
          {t('create.submit')}
        </Button>
      }
    >
      <div className="space-y-3">
        {create.error ? <IssueTrouble error={create.error} work={project.work} /> : null}
        <Field label={t('create.titleField')} required>
          {(id) => <Input id={id} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />}
        </Field>
        <Field label={t('create.bodyField')}>
          {() => <MarkdownEditor value={body} onChange={setBody} placeholder={t('create.bodyPlaceholder')} />}
        </Field>

        {vocabulary.error ? (
          <Callout tone="neutral">{t('create.vocabularyUnavailable')}</Callout>
        ) : catalog ? (
          <>
            <Field label={t('create.labels')}>
              {() => (
                <ChipPicker
                  options={catalog.labels.map((label) => ({
                    value: label.name,
                    label: label.name,
                    color: label.color,
                  }))}
                  selected={labels}
                  onToggle={(value) => setLabels(toggle(labels, value))}
                />
              )}
            </Field>
            <Field label={t('create.assignees')}>
              {() => (
                <ChipPicker
                  options={catalog.assignees.map((user) => ({ value: user.login, label: user.login }))}
                  selected={assignees}
                  onToggle={(value) => setAssignees(toggle(assignees, value))}
                />
              )}
            </Field>
            {catalog.milestones.length > 0 ? (
              <Field label={t('create.milestone')}>
                {(id) => (
                  <Select
                    id={id}
                    value={milestone}
                    onChange={(event) => setMilestone(event.target.value)}
                    className="w-full"
                  >
                    <option value="">{t('create.noMilestone')}</option>
                    {catalog.milestones.map((entry) => (
                      <option key={entry.title} value={entry.title}>
                        {entry.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  )
}

function toggle(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
}

/**
 * A short vocabulary, as chips that are either on or off. A repository with
 * ninety labels scrolls inside its own box rather than pushing the title field
 * off the top of the dialog.
 */
function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ value: string; label: string; color?: string | null }>
  selected: string[]
  onToggle: (value: string) => void
}) {
  const { t } = useTranslation('issues')
  if (options.length === 0) return <p className="text-xs text-subtle">{t('create.noVocabulary')}</p>
  return (
    <div className="flex max-h-28 flex-wrap items-start gap-1 overflow-y-auto rounded-md border border-line bg-surface-2 p-1.5 scroll-thin">
      {options.map((option) => {
        const on = selected.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option.value)}
            className={cn(
              'inline-flex h-6 max-w-48 items-center gap-1 rounded-full border px-2 text-2xs transition-colors duration-100 focus-ring',
              on ? 'border-accent/40 bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:text-ink',
            )}
          >
            {option.color !== undefined ? (
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-subtle"
                style={option.color ? { backgroundColor: `#${option.color}` } : undefined}
              />
            ) : null}
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
