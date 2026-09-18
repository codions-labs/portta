'use client'

import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'

interface WorktreeLabelDialogProps {
  branch: string
  initialLabel: string | null
  loading?: boolean
  error?: string
  onConfirm: (label: string) => void
  onClear: () => void
  onCancel: () => void
}

export function WorktreeLabelDialog({
  branch,
  initialLabel,
  loading = false,
  error = '',
  onConfirm,
  onClear,
  onCancel,
}: WorktreeLabelDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'labelDialog' })
  const { t: tc } = useTranslation('common')
  const formId = useId()
  const [currentLabel, setCurrentLabel] = useState(initialLabel ?? '')
  const normalizedInitialLabel = (initialLabel ?? '').trim()
  const normalizedLabel = currentLabel.trim()
  const canSave = !loading && normalizedLabel !== normalizedInitialLabel

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (canSave) onConfirm(normalizedLabel)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      size="sm"
      title={t('title')}
      footer={
        <>
          <Button size="sm" variant="ghost" className="mr-auto" onClick={onClear} disabled={loading || !initialLabel}>
            {tc('clear')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}>
            {tc('cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" form={formId} busy={loading} disabled={!canSave}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-3" onSubmit={submit}>
        <Field label={t('label')} id="worktree-label-input">
          <Input
            id="worktree-label-input"
            maxLength={80}
            autoFocus
            value={currentLabel}
            onChange={(event) => setCurrentLabel(event.currentTarget.value)}
            placeholder={branch}
            disabled={loading}
          />
        </Field>
        {error ? <ErrorBox error={error} /> : null}
      </form>
    </Dialog>
  )
}
