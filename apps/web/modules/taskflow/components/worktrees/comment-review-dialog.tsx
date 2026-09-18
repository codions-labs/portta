'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { useTaskflowProject } from '../../lib/project.tsx'
import { normalizeTextForPrompt } from '../../lib/prompt-utils.ts'
import type { PrComment, PrEntry } from '../../lib/types.ts'
import { errorMessage, prLabel } from '../../lib/utils.ts'

interface CommentReviewDialogProps {
  pr: PrEntry
  branch: string
  onClose: () => void
  onSendSuccess: () => void
}

function formatComment(comment: PrComment, index: number): string {
  if (comment.type === 'inline') {
    const location = comment.line ? `${comment.path}:${comment.line}` : comment.path
    const hunk = comment.diffHunk ? `\n\`\`\`diff\n${comment.diffHunk}\n\`\`\`\n` : '\n'
    return `[${index}] @${comment.author} (${comment.createdAt.slice(0, 10)}) on ${location}:${hunk}${comment.body}`
  }
  return `[${index}] @${comment.author} (${comment.createdAt.slice(0, 10)}):\n${comment.body}`
}

export function CommentReviewDialog({ pr, branch, onClose, onSendSuccess }: CommentReviewDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'comments' })
  const { api } = useTaskflowProject()
  const { t: tc } = useTranslation('common')
  const [selected, setSelected] = useState<Set<number>>(() => new Set(pr.comments.map((_, index) => index)))
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const toast = useToast()
  const label = prLabel(pr)
  const sortedComments = pr.comments
    .map((comment, originalIndex) => ({ comment, originalIndex }))
    .toSorted((left, right) => right.comment.createdAt.localeCompare(left.comment.createdAt))
  const allSelected = selected.size === pr.comments.length
  const noneSelected = selected.size === 0

  useEffect(() => {
    setSelected(new Set(pr.comments.map((_, index) => index)))
  }, [pr.comments])

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(pr.comments.map((_, index) => index)))
  }

  function toggleOne(index: number): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function send(): Promise<void> {
    if (!branch || noneSelected) return
    setSending(true)
    setSendError('')
    // The prompt is written for the agent, not for the reader, so it stays in English.
    const preamble = `${[
      'Review these comments and elaborate a plan to address the ones you find relevant.',
      `PR: ${label}`,
      '',
      'Comments:',
    ].join('\n')}\n`
    const content = pr.comments
      .filter((_, index) => selected.has(index))
      .map((comment, index) => formatComment(comment, index + 1))
      .join('\n\n')
    try {
      await api.sendWorktreePrompt(branch, normalizeTextForPrompt(content, 20000), preamble)
      toast.push({ tone: 'ok', title: t('sent', { count: selected.size }) })
      onSendSuccess()
    } catch (caught) {
      setSendError(errorMessage(caught))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="lg"
      title={t('title', { pr: label })}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" size="sm" busy={sending} disabled={noneSelected} onClick={() => void send()}>
            {t('send', { count: selected.size })}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <Button size="xs" variant="link" onClick={toggleAll}>
          {allSelected ? t('deselectAll') : t('selectAll')}
        </Button>
        <span className="text-2xs text-subtle">
          {t('selectedCount', { selected: selected.size, total: pr.comments.length })}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sortedComments.map(({ comment, originalIndex }) => (
          <li className="rounded-md border border-line bg-surface p-3" key={originalIndex}>
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={selected.has(originalIndex)}
                onChange={() => toggleOne(originalIndex)}
              />
              <div className="min-w-0 flex-1">
                {comment.type === 'inline' ? (
                  <div className="mb-1 truncate font-mono text-2xs text-accent" title={comment.path}>
                    {comment.path}
                    {comment.line ? `:${comment.line}` : ''}
                    {comment.isReply ? <span className="ml-1 text-subtle">{t('reply')}</span> : null}
                  </div>
                ) : null}
                <div className="mb-1 text-xs text-subtle">
                  <span className="font-medium text-ink">@{comment.author}</span> · {comment.createdAt.slice(0, 10)}
                  {comment.type === 'inline' ? (
                    <>
                      {' '}
                      <span className="ml-1 text-accent/70">{t('review')}</span>
                    </>
                  ) : null}
                </div>
                <pre className="m-0 whitespace-pre-wrap font-mono text-2xs text-muted">{comment.body}</pre>
              </div>
            </label>
          </li>
        ))}
      </ul>
      {sendError ? (
        <div className="mt-3">
          <ErrorBox error={sendError} />
        </div>
      ) : null}
    </Dialog>
  )
}
