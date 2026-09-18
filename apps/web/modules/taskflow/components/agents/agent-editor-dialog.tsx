'use client'

import { AGENT_TEMPLATE_VARIABLES, APP_NAME, agentTemplatePlaceholder } from 'portta-core/taskflow/config'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/field'
import type { UpsertCustomAgentRequest, ValidateCustomAgentResponse } from '../../lib/types.ts'
import { errorMessage } from '../../lib/utils.ts'

interface AgentEditorDialogProps {
  title: string
  initialValue: { label: string; startCommand: string; resumeCommand: string }
  onSave: (value: UpsertCustomAgentRequest) => Promise<void>
  onValidate?: (value: UpsertCustomAgentRequest) => Promise<ValidateCustomAgentResponse>
  onClose: () => void
}

const placeholders = AGENT_TEMPLATE_VARIABLES.map(agentTemplatePlaceholder)

export function AgentEditorDialog({ title, initialValue, onSave, onValidate, onClose }: AgentEditorDialogProps) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'agents.editor' })
  const { t: tc } = useTranslation('common')
  const formId = useId()
  const [label, setLabel] = useState(initialValue.label)
  const [startCommand, setStartCommand] = useState(initialValue.startCommand)
  const [resumeCommand, setResumeCommand] = useState(initialValue.resumeCommand)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidateCustomAgentResponse | null>(null)
  const canSave = label.trim().length > 0 && startCommand.trim().length > 0

  function buildRequest(): UpsertCustomAgentRequest {
    return {
      label: label.trim(),
      startCommand: startCommand.trim(),
      ...(resumeCommand.trim() ? { resumeCommand: resumeCommand.trim() } : {}),
    }
  }

  async function validate(): Promise<void> {
    if (!canSave || saving || validating || !onValidate) return
    setValidating(true)
    setError(null)
    try {
      setValidation(await onValidate(buildRequest()))
    } catch (caught) {
      setError(errorMessage(caught))
      setValidation(null)
    } finally {
      setValidating(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(buildRequest())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          {onValidate ? (
            <Button size="sm" onClick={() => void validate()} busy={validating} disabled={!canSave || saving}>
              {t('test')}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" type="submit" form={formId} busy={saving} disabled={!canSave}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" onSubmit={(event) => void submit(event)}>
        <Field label={t('name')} id="agent-label">
          <Input
            id="agent-label"
            type="text"
            placeholder={t('namePlaceholder')}
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </Field>
        <Field label={t('startCommand')} id="agent-start-command">
          <Textarea
            id="agent-start-command"
            rows={4}
            mono
            className="resize-y"
            placeholder={t('example', {
              command: `pi --append-system-prompt "${agentTemplatePlaceholder('SYSTEM_PROMPT')}" "${agentTemplatePlaceholder('PROMPT')}"`,
            })}
            value={startCommand}
            onChange={(event) => setStartCommand(event.currentTarget.value)}
          />
        </Field>
        <Field
          label={
            <>
              {t('resumeCommand')} <span className="opacity-60">{t('optional')}</span>
            </>
          }
          id="agent-resume-command"
        >
          <Input
            id="agent-resume-command"
            type="text"
            mono
            placeholder={t('example', {
              command: `pi -c --append-system-prompt "${agentTemplatePlaceholder('SYSTEM_PROMPT')}"`,
            })}
            value={resumeCommand}
            onChange={(event) => setResumeCommand(event.currentTarget.value)}
          />
        </Field>
        <div className="rounded-md border border-line bg-surface-2/60 p-3">
          <p className="text-sm text-ink">{t('placeholders')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-2xs text-subtle">
            {placeholders.map((placeholder) => (
              <span className="rounded-full border border-line px-1.5 py-0.5" key={placeholder}>
                {placeholder}
              </span>
            ))}
          </div>
          <p className="mt-2 text-2xs text-subtle">{t('placeholdersHint', { app: APP_NAME })}</p>
        </div>
        {validation ? (
          <div className="rounded-md border border-line bg-surface-2/60 p-3 text-xs">
            <p className="text-ink">
              {t('agentId')} <span className="font-mono">{validation.normalizedId}</span>
            </p>
            {validation.warnings.length > 0 ? (
              <ul className="mt-2 space-y-1 text-subtle">
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-ok">{t('looksGood')}</p>
            )}
          </div>
        ) : null}
        {error ? <ErrorBox error={error} /> : null}
      </form>
    </Dialog>
  )
}
