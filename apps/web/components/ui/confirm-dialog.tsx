'use client'

import { AlertTriangle } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '../shell-bits.tsx'
import { Button } from './button.tsx'
import { Dialog } from './dialog.tsx'
import { Input } from './field.tsx'

/**
 * The one confirmation in the panel.
 *
 * "Are you sure?" is not a question anybody can answer, so this dialog refuses
 * to ask it: the caller supplies what will happen (`impact`) and, when the
 * action cannot be undone, the exact name the operator has to type. Everything
 * destructive routes through here so the wording, the tone and the keyboard
 * behaviour are the same wherever the action is offered.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  impact,
  details,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  /** When set, the button stays disabled until the operator types this exactly. */
  requireTyped,
  requireTypedHint,
  busy = false,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** One sentence naming the consequence, in numbers where there are numbers. */
  impact: ReactNode
  /** What exactly is affected: the containers, the volumes, the rows. */
  details?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  requireTyped?: string
  requireTypedHint?: string
  busy?: boolean
  error?: unknown
  onConfirm: () => void
}) {
  const { t } = useTranslation('common')
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  const ready = requireTyped === undefined || typed.trim() === requireTyped

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          {tone === 'danger' ? <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden /> : null}
          {title}
        </span>
      }
      description={impact}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            disabled={!ready}
            busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {details ? <div className="text-sm text-ink">{details}</div> : null}
        {requireTyped !== undefined ? (
          <label className="block space-y-1">
            <span className="block text-xs text-muted">
              {requireTypedHint ?? t('typeToConfirm', { value: requireTyped })}
            </span>
            <Input
              mono
              value={typed}
              autoFocus
              onChange={(event) => setTyped(event.target.value)}
              placeholder={requireTyped}
              aria-label={requireTypedHint ?? t('typeToConfirm', { value: requireTyped })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && ready && !busy) onConfirm()
              }}
            />
          </label>
        ) : null}
        {error ? <ErrorBox error={error} /> : null}
      </div>
    </Dialog>
  )
}
