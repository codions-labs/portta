'use client'

import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { iconButton, overlaySurface } from '@/components/ui/surfaces'
import type { ToastItem, ToastTone } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'

/**
 * The agent notifications the server pushes. They are not Portta toasts: one
 * can be opened (it selects the worktree it is about) and dismissing it tells
 * the server, so it does not come back on the next page load. UI feedback goes
 * through `useToast` from components/ui/toast instead.
 */
interface ToastStackProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
  onSelect?: (id: string) => void
}

const ICON: Record<ToastTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-accent' },
  success: { icon: CheckCircle2, className: 'text-ok' },
  error: { icon: XCircle, className: 'text-danger' },
}

function ToastBody({ toast }: { toast: ToastItem }) {
  const { icon: Icon, className } = ICON[toast.tone]
  return (
    <>
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', className)} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words whitespace-normal text-sm font-medium text-ink">{toast.message}</span>
        {toast.detail ? <span className="break-all whitespace-normal text-xs text-accent">{toast.detail}</span> : null}
      </span>
    </>
  )
}

function SelectableBody({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (onClick) {
    return (
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xs text-left focus-ring"
        onClick={onClick}
      >
        {children}
      </button>
    )
  }

  return <div className="flex min-w-0 flex-1 items-start gap-2.5">{children}</div>
}

export function ToastStack({ toasts, onDismiss, onSelect }: ToastStackProps) {
  const { t } = useTranslation('common')
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-14 right-4 z-[60] flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          className={cn('pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 animate-toast-in', overlaySurface)}
          role="alert"
          key={toast.id}
        >
          <SelectableBody onClick={onSelect && toast.source === 'notification' ? () => onSelect(toast.id) : undefined}>
            <ToastBody toast={toast} />
          </SelectableBody>
          <button
            type="button"
            className={cn(iconButton, '-mr-1')}
            aria-label={t('dismiss')}
            onClick={() => onDismiss(toast.id)}
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  )
}
