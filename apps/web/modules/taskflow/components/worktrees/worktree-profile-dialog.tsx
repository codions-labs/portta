'use client'

import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { ProfileConfig } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'

interface WorktreeProfileDialogProps {
  branch: string
  profiles: ProfileConfig[]
  currentProfile: string | null
  isOpen: boolean
  loading?: boolean
  error?: string
  onConfirm: (profile: string) => void
  onCancel: () => void
}

export function WorktreeProfileDialog({
  branch,
  profiles,
  currentProfile,
  isOpen,
  loading = false,
  error = '',
  onConfirm,
  onCancel,
}: WorktreeProfileDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'profileDialog' })
  const { t: tc } = useTranslation('common')
  const formId = useId()
  const [selected, setSelected] = useState(currentProfile ?? '')
  const canSave = !loading && selected.length > 0 && selected !== currentProfile

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (canSave) onConfirm(selected)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      size="sm"
      title={t('title')}
      description={branch}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}>
            {tc('cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" form={formId} busy={loading} disabled={!canSave}>
            {t('switch')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-3" onSubmit={submit}>
        <div className="flex flex-col gap-2">
          {profiles.map((profile) => (
            <label
              key={profile.name}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm transition-colors duration-100',
                selected === profile.name ? 'border-accent bg-selection' : 'border-line hover:bg-fill',
              )}
            >
              <input
                type="radio"
                name="worktree-profile"
                value={profile.name}
                checked={selected === profile.name}
                onChange={() => setSelected(profile.name)}
                disabled={loading}
                className="accent-accent"
              />
              {profile.name}
            </label>
          ))}
        </div>
        <p className="text-xs text-subtle">{isOpen ? t('restartHint') : t('nextOpenHint')}</p>
        {error ? <ErrorBox error={error} /> : null}
      </form>
    </Dialog>
  )
}
