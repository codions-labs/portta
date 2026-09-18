'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'

export function EditableTitle({
  value,
  pending,
  error,
  disabled,
  autoFocus,
  onSave,
}: {
  value: string
  pending?: boolean
  error?: string | null
  disabled?: boolean
  autoFocus?: boolean
  onSave: (title: string) => Promise<unknown> | unknown
}) {
  const { t } = useTranslation('issues')
  const [editing, setEditing] = useState(Boolean(autoFocus))
  const [draftTitle, setDraftTitle] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const saving = useRef(false)

  useEffect(() => {
    setDraftTitle(value)
  }, [value])
  useEffect(() => {
    if (editing) input.current?.focus()
  }, [editing])

  const confirm = async () => {
    if (saving.current) return
    const next = draftTitle.trim()
    if (next === '' || next === value) {
      setDraftTitle(value)
      setEditing(false)
      return
    }
    saving.current = true
    try {
      await onSave(next)
      setEditing(false)
    } catch {
      // The parent owns the visible error state. Keep this editor and draft
      // open so a rejected save never turns into an unhandled event or loss.
    } finally {
      saving.current = false
    }
  }

  if (editing && !disabled) {
    return (
      <div>
        <input
          ref={input}
          value={draftTitle}
          aria-label={t('title.label')}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={() => void confirm()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void confirm()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraftTitle(value)
              setEditing(false)
            }
          }}
          className="w-full rounded-sm bg-transparent text-xl font-semibold text-ink outline-none ring-2 ring-accent/30"
        />
        {pending ? <p className="mt-1 text-xs text-subtle">{t('title.saving')}</p> : null}
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    )
  }

  return (
    <div>
      <h1>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setDraftTitle(value)
            setEditing(true)
          }}
          className={cn(
            '-mx-1 block w-[calc(100%+0.5rem)] rounded-sm px-1 text-left text-xl font-semibold text-ink focus-ring',
            'transition-colors duration-100 hover:bg-fill',
          )}
        >
          {value}
        </button>
      </h1>
      {pending ? <p className="mt-1 text-xs text-subtle">{t('title.saving')}</p> : null}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  )
}
