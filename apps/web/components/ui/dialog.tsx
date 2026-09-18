'use client'

import * as Primitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'
import { iconButton } from './surfaces.ts'

const SIZES = {
  sm: 'w-[min(92vw,26rem)]',
  md: 'w-[min(92vw,34rem)]',
  lg: 'w-[min(94vw,48rem)]',
} as const

/** The scrim behind any modal surface: the dialog and the drawer share it. */
export function Scrim({ className }: { className?: string }) {
  return (
    <Primitive.Overlay className={cn('fixed inset-0 z-40 bg-scrim data-[state=open]:animate-fade-in', className)} />
  )
}

/** The header every modal surface uses: a title, a description, the close. */
export function ModalHeader({
  title,
  description,
  dismissible = true,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  dismissible?: boolean
  children?: ReactNode
}) {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <Primitive.Title className="text-base font-semibold text-ink">{title}</Primitive.Title>
        {description ? (
          <Primitive.Description className="mt-0.5 text-sm text-subtle">{description}</Primitive.Description>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {dismissible ? (
          <Primitive.Close className={iconButton} aria-label={t('close')}>
            <X />
          </Primitive.Close>
        ) : null}
      </div>
    </div>
  )
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-2 border-t border-line px-4 py-3', className)}>
      {children}
    </div>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  dismissible = true,
  onCloseAutoFocus,
}: {
  onCloseAutoFocus?: (event: Event) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: keyof typeof SIZES
  className?: string
  /**
   * A dialog reporting work that is already running has nothing to cancel, and
   * an escape key that only hides it would lose the one place the progress is
   * shown. Such a dialog closes when the work ends, not before.
   */
  dismissible?: boolean
}) {
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(next) => {
        if (dismissible || next) onOpenChange(next)
      }}
    >
      <Primitive.Portal>
        <Scrim />
        <Primitive.Content
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault()
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none',
            'rounded-xl border border-line bg-surface shadow-modal data-[state=open]:animate-dialog-in',
            SIZES[size],
            className,
          )}
        >
          <ModalHeader title={title} description={description} dismissible={dismissible} />
          <div className="max-h-[60vh] overflow-y-auto px-4 py-3 scroll-thin">{children}</div>
          {footer ? <ModalFooter>{footer}</ModalFooter> : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
