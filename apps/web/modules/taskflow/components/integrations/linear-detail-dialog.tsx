'use client'

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { LinearIssue } from '../../lib/types.ts'

interface LinearDetailDialogProps {
  issue: LinearIssue
  onAssign: (issue: LinearIssue) => void
  onClose: () => void
}

export function LinearDetailDialog({ issue, onAssign, onClose }: LinearDetailDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'linear' })
  const { t: tc } = useTranslation('common')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="lg"
      title={issue.title}
      description={
        <span className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: issue.state.color }} />
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-accent no-underline hover:underline"
          >
            {issue.identifier}
          </a>
          <span className="text-2xs">{issue.state.name}</span>
          <span className="text-2xs">· {issue.priorityLabel}</span>
        </span>
      }
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => onAssign(issue)}>
            {t('implement')}
          </Button>
        </>
      }
    >
      {issue.description ? (
        <div className="mb-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted scroll-thin">
          {issue.description}
        </div>
      ) : (
        <p className="mb-4 text-sm text-subtle italic">{t('noDescription')}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-2xs text-subtle">
        <span>{issue.team.key}</span>
        {issue.project ? <span>· {issue.project}</span> : null}
        {issue.labels.map((label) => (
          <span
            className="rounded-full px-1.5 py-0.5 text-2xs"
            style={{ color: label.color, background: `${label.color}20` }}
            key={label.name}
          >
            {label.name}
          </span>
        ))}
        {issue.dueDate ? <span>{t('due', { date: issue.dueDate })}</span> : null}
      </div>
    </Dialog>
  )
}
