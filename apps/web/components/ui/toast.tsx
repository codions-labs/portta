'use client'

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'
import { iconButton, overlaySurface } from './surfaces.ts'

export type ToastTone = 'neutral' | 'ok' | 'warn' | 'danger'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  /** Milliseconds before it goes away on its own. 0 keeps it until dismissed. */
  duration?: number
  /** One thing to do about it, offered inline: undo, open, retry. */
  action?: { label: string; onClick: () => void }
}

interface Toast extends ToastInput {
  id: number
  tone: ToastTone
}

interface ToastApi {
  push: (toast: ToastInput) => number
  dismiss: (id: number) => void
}

/**
 * Without a provider the hook still answers, and does nothing. A component
 * rendered alone in a test, or in a place the provider does not reach, should
 * not need a wrapper to exist.
 */
const NOOP: ToastApi = { push: () => 0, dismiss: () => {} }
const ToastContext = createContext<ToastApi>(NOOP)

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

const DEFAULT_DURATION = 6_000

const ICON: Record<ToastTone, { icon: typeof Info; className: string }> = {
  neutral: { icon: Info, className: 'text-subtle' },
  ok: { icon: CheckCircle2, className: 'text-ok' },
  warn: { icon: AlertTriangle, className: 'text-warn' },
  danger: { icon: XCircle, className: 'text-danger' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (input: ToastInput) => {
      const id = ++counter.current
      const toast: Toast = { ...input, id, tone: input.tone ?? 'neutral' }
      setToasts((current) => [...current.slice(-4), toast])
      const duration = input.duration ?? DEFAULT_DURATION
      if (duration > 0) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label={t('notifications')}
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = ICON[toast.tone]
          return (
            <div
              key={toast.id}
              role={toast.tone === 'danger' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 text-sm animate-toast-in',
                overlaySurface,
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{toast.title}</div>
                {toast.description ? (
                  <div className="mt-0.5 break-words text-xs text-subtle">{toast.description}</div>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    className="mt-1.5 text-xs font-medium text-accent hover:underline focus-ring rounded-xs"
                    onClick={() => {
                      toast.action?.onClick()
                      dismiss(toast.id)
                    }}
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className={cn(iconButton, '-mr-1')}
                aria-label={t('dismiss')}
                onClick={() => dismiss(toast.id)}
              >
                <X />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
