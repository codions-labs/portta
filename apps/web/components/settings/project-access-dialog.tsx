'use client'

import { useMutation } from '@tanstack/react-query'
import type { ProjectSummary, User } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { ProjectPicker } from './project-picker'

/** Membership is the whole list, replaced: `PUT`, not a pair of add/remove. */
export function ProjectAccessDialog({
  open,
  onOpenChange,
  user,
  projects,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User
  projects: ProjectSummary[]
  onSaved: () => void
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [selected, setSelected] = useState<number[]>(user.projects.map((project) => project.id))

  const save = useMutation({
    mutationFn: () => api.setUserProjects(user.id, selected),
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.projectAccessFor', { name: user.name })}
      description={t('users.projectAccessHint')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? tc('saving') : tc('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {save.error ? <ErrorBox error={save.error} /> : null}
        <ProjectPicker projects={projects} selected={selected} onChange={setSelected} disabled={save.isPending} />
      </div>
    </Dialog>
  )
}
