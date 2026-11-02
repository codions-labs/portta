'use client'

// The labels on a Project: shown beside its name, and edited where they are shown.
// They group and filter. They grant and hide nothing, so anybody who may update a
// Project may tag it.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import type { ProjectTag } from 'portta-contracts'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { MAX_TAGS, parseTag, tagLabel } from '@/lib/projects'
import { keys } from '@/lib/queries'

export function TagPill({
  tag,
  onRemove,
  removeLabel,
}: {
  tag: ProjectTag
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-info/10 px-2 py-px text-xs leading-normal font-semibold whitespace-nowrap text-info">
      {tag.key !== '' ? <i className="font-medium not-italic opacity-80">{tag.key}:</i> : null}
      {tag.value}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 grid size-4 place-items-center rounded-xs hover:bg-info/15 focus-ring"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  )
}

export function ProjectTags({ slug, tags }: { slug: string; tags: readonly ProjectTag[] }) {
  const { t } = useTranslation('projects', { keyPrefix: 'tags' })
  const mayEdit = useCan('project:update')
  const queryClient = useQueryClient()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  const save = useMutation({
    mutationFn: (next: ProjectTag[]) => api.setProjectTags(slug, next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.projects() }),
    onError: (error) => toast.push({ tone: 'danger', title: t('failed'), description: String(error) }),
  })

  const add = () => {
    const tag = parseTag(text)
    setAdding(false)
    setText('')
    if (!tag || tags.some((existing) => tagLabel(existing) === tagLabel(tag))) return
    save.mutate([...tags, tag])
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    } else if (event.key === 'Escape') {
      setAdding(false)
      setText('')
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <TagPill
          key={tagLabel(tag)}
          tag={tag}
          onRemove={mayEdit ? () => save.mutate(tags.filter((other) => other !== tag)) : undefined}
          removeLabel={t('remove', { tag: tagLabel(tag) })}
        />
      ))}
      {mayEdit && adding ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by the click that asked for it
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={t('placeholder')}
          aria-label={t('new')}
          className="h-6 w-44 rounded-md border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-accent"
        />
      ) : mayEdit && tags.length < MAX_TAGS ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label={t('add')}
          className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-line-strong px-1.5 py-px text-xs font-medium text-subtle hover:border-accent hover:text-ink focus-ring"
        >
          <Plus className="size-3" aria-hidden />
          {t('addShort')}
        </button>
      ) : null}
    </span>
  )
}
