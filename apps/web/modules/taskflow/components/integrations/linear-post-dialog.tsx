'use client'

import { parseLinearTarget } from 'portta-contracts/taskflow'
import { APP_NAME } from 'portta-core/taskflow/config'
import { type FormEvent, useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import type { PostWorktreeToLinearTarget } from '../../lib/types.ts'
import { errorMessage } from '../../lib/utils.ts'

interface LinearPostDialogProps {
  branch: string
  onSubmit: (target: PostWorktreeToLinearTarget) => Promise<void> | void
  onClose: () => void
}

export function LinearPostDialog({ branch, onSubmit, onClose }: LinearPostDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'linear.post' })
  const { t: tc } = useTranslation('common')
  const formId = useId()
  const [teamKey, setTeamKey] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const teamKeyTrimmed = teamKey.trim().toUpperCase()
  const parsed = parseLinearTarget(teamKeyTrimmed)
  const teamKeyLooksLikeIssue = parsed.kind === 'issue'
  const teamKeyValid = parsed.kind === 'team'

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!teamKeyValid || loading) return
    setLoading(true)
    setError('')
    try {
      const target: PostWorktreeToLinearTarget = title.trim()
        ? { kind: 'team', teamKey: teamKeyTrimmed, title: title.trim() }
        : { kind: 'team', teamKey: teamKeyTrimmed }
      await onSubmit(target)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('title')}
      description={
        <Trans t={t} i18nKey="description" values={{ branch }} components={{ mono: <span className="font-mono" /> }} />
      }
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={loading}>
            {tc('cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" form={formId} busy={loading} disabled={!teamKeyValid}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-3" onSubmit={(event) => void submit(event)}>
        <Field
          label={t('teamKey')}
          id="linear-team"
          error={
            teamKeyTrimmed && teamKeyLooksLikeIssue
              ? t('looksLikeIssue', { issue: teamKeyTrimmed })
              : teamKeyTrimmed && !teamKeyValid
                ? t('invalidTeamKey')
                : undefined
          }
        >
          <Input
            id="linear-team"
            type="text"
            mono
            className="uppercase"
            placeholder="ENG"
            value={teamKey}
            onChange={(event) => setTeamKey(event.currentTarget.value)}
            autoComplete="off"
          />
        </Field>
        <Field
          label={
            <>
              {t('issueTitle')} <span className="opacity-60">{t('optional')}</span>
            </>
          }
          id="linear-title"
        >
          <Input
            id="linear-title"
            type="text"
            placeholder={t('titlePlaceholder', { app: APP_NAME, branch })}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Field>
        {error ? <ErrorBox error={error} /> : null}
      </form>
    </Dialog>
  )
}
